export const RESOURCE_CATALOG = Object.freeze({
  scheduler: {
    name: "TH Operations Scheduler",
    description: "Shared schedule, coverage, staffing, and restore history.",
    url: "/tools/th-operations-scheduler/",
    requestLevel: "edit"
  },
  fire_drill: {
    name: "Fire Drill Viewer",
    description: "Private emergency response training deck and source presentation.",
    url: "/tools/fire-drill-training/",
    requestLevel: "view"
  },
  staff: {
    name: "Staff Operations",
    description: "Private roster, contacts, credential dates, staff messaging, occurrence tracking, and XLSX exports.",
    url: "/private/staff/",
    requestLevel: "view"
  }
});

const ACCESS_RANK = Object.freeze({ none: 0, view: 1, edit: 2 });
let schemaPromise = null;

export const ensurePrivateSchema = async (database) => {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await database.batch([
      database.prepare(`CREATE TABLE IF NOT EXISTS private_users (
        email TEXT PRIMARY KEY,
        role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      )`),
      database.prepare(`CREATE TABLE IF NOT EXISTS private_permissions (
        user_email TEXT NOT NULL,
        resource_key TEXT NOT NULL,
        access_level TEXT NOT NULL CHECK (access_level IN ('view', 'edit')),
        granted_by TEXT NOT NULL,
        granted_at TEXT NOT NULL,
        PRIMARY KEY (user_email, resource_key),
        FOREIGN KEY (user_email) REFERENCES private_users(email) ON DELETE CASCADE
      )`),
      database.prepare(`CREATE TABLE IF NOT EXISTS access_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT NOT NULL,
        resource_key TEXT NOT NULL,
        requested_level TEXT NOT NULL DEFAULT 'view' CHECK (requested_level IN ('view', 'edit')),
        message TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
        requested_at TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by TEXT,
        FOREIGN KEY (user_email) REFERENCES private_users(email) ON DELETE CASCADE
      )`),
      database.prepare(`CREATE TABLE IF NOT EXISTS staff_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        role_title TEXT NOT NULL DEFAULT '',
        site TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        guard_card_expiration TEXT NOT NULL DEFAULT '',
        cpr_expiration TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'leave', 'inactive')),
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL
      )`),
      database.prepare(`CREATE TABLE IF NOT EXISTS staff_occurrences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER NOT NULL,
        occurrence_date TEXT NOT NULL,
        occurrence_type TEXT NOT NULL CHECK (occurrence_type IN ('call_off', 'no_call_no_show', 'late', 'left_early', 'documentation')),
        points INTEGER NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        FOREIGN KEY (staff_id) REFERENCES staff_records(id) ON DELETE CASCADE
      )`),
      database.prepare(`CREATE TABLE IF NOT EXISTS staff_email_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_email TEXT NOT NULL,
        delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('bcc', 'separate')),
        recipient_count INTEGER NOT NULL,
        subject TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        provider_ids_json TEXT NOT NULL DEFAULT '[]'
      )`),
      database.prepare("CREATE UNIQUE INDEX IF NOT EXISTS access_requests_one_pending ON access_requests (user_email, resource_key) WHERE status = 'pending'"),
      database.prepare("CREATE INDEX IF NOT EXISTS access_requests_status_requested ON access_requests (status, requested_at DESC)"),
      database.prepare("CREATE INDEX IF NOT EXISTS staff_records_status_name ON staff_records (status, full_name COLLATE NOCASE)"),
      database.prepare("CREATE INDEX IF NOT EXISTS staff_occurrences_staff_date ON staff_occurrences (staff_id, occurrence_date DESC)")
      ]);

      // Existing deployments may have the first staff table revision.
      const columns = await database.prepare("PRAGMA table_info(staff_records)").all();
      const columnNames = new Set((columns.results || []).map((column) => column.name));
      if (!columnNames.has("guard_card_expiration")) {
        await database.prepare("ALTER TABLE staff_records ADD COLUMN guard_card_expiration TEXT NOT NULL DEFAULT ''").run();
      }
      if (!columnNames.has("cpr_expiration")) {
        await database.prepare("ALTER TABLE staff_records ADD COLUMN cpr_expiration TEXT NOT NULL DEFAULT ''").run();
      }
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
};

export const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  }
});

export const ownerEmailFor = (context) => String(context.env.OWNER_EMAIL || "").trim().toLowerCase();

export const requireSameOrigin = (request) => {
  const origin = request.headers.get("Origin");
  return origin === new URL(request.url).origin;
};

export const parseJson = async (request, maxBytes = 50_000) => {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) throw json({ error: "Content-Type must be application/json" }, 415);
  const text = await request.text();
  if (text.length > maxBytes) throw json({ error: "Request is too large" }, 413);
  try { return JSON.parse(text); }
  catch { throw json({ error: "Request contains invalid JSON" }, 400); }
};

export const ensurePrivateUser = async (database, email, ownerEmail) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const now = new Date().toISOString();
  const role = normalizedEmail === ownerEmail ? "owner" : "member";
  await database.prepare(
    `INSERT INTO private_users (email, role, created_at, last_seen_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       role = CASE WHEN excluded.role = 'owner' THEN 'owner' ELSE private_users.role END,
       last_seen_at = excluded.last_seen_at`
  ).bind(normalizedEmail, role, now, now).run();
  return { email: normalizedEmail, role, isAdmin: role === "owner" };
};

export const getAccessLevel = async (database, email, resourceKey, ownerEmail) => {
  if (email === ownerEmail) return "edit";
  const row = await database.prepare(
    "SELECT access_level FROM private_permissions WHERE user_email = ? AND resource_key = ?"
  ).bind(email, resourceKey).first();
  return row?.access_level || "none";
};

export const hasResourceAccess = async (database, email, resourceKey, requiredLevel, ownerEmail) => {
  const granted = await getAccessLevel(database, email, resourceKey, ownerEmail);
  return ACCESS_RANK[granted] >= ACCESS_RANK[requiredLevel];
};

export const requireResourceAccess = async (context, resourceKey, requiredLevel = "view") => {
  const user = context.data.privateUser;
  if (!user) return { response: json({ error: "Authentication required" }, 401) };
  const ownerEmail = ownerEmailFor(context);
  const accessLevel = await getAccessLevel(context.env.SCHEDULER_DB, user.email, resourceKey, ownerEmail);
  if (ACCESS_RANK[accessLevel] < ACCESS_RANK[requiredLevel]) {
    return { response: json({ error: "Access has not been granted", resourceKey, accessLevel }, 403) };
  }
  return { accessLevel };
};

export const requireAdmin = (context) => {
  if (!context.data.privateUser?.isAdmin) return json({ error: "Administrator access required" }, 403);
  return null;
};

export const privateErrorResponse = (error) => {
  if (error instanceof Response) return error;
  console.error("Private workspace error", error);
  return json({ error: "Private workspace service failed" }, 500);
};
