import { json } from "./private-access.js";

const encoder = new TextEncoder();
const allowedRecordTypes = new Set([
  "day",
  "templates",
  "saved_events",
  "preferences",
  "dismissed_alarms"
]);

export const ensureLifeManagerSchema = async (database) => {
  await database.batch([
    database.prepare(`CREATE TABLE IF NOT EXISTS life_manager_pairings (
      id TEXT PRIMARY KEY, user_code TEXT NOT NULL UNIQUE, device_id TEXT NOT NULL,
      device_name TEXT NOT NULL, verifier_challenge TEXT NOT NULL, owner_email TEXT,
      status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL, approved_at TEXT, consumed_at TEXT
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS life_manager_pairings_code_status ON life_manager_pairings (user_code, status, expires_at)"),
    database.prepare(`CREATE TABLE IF NOT EXISTS life_manager_devices (
      owner_email TEXT NOT NULL, device_id TEXT NOT NULL, device_name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
      revoked_at TEXT, PRIMARY KEY (owner_email, device_id)
    )`),
    database.prepare("CREATE TABLE IF NOT EXISTS life_manager_sync_cursors (owner_email TEXT PRIMARY KEY, cursor INTEGER NOT NULL DEFAULT 0)"),
    database.prepare(`CREATE TABLE IF NOT EXISTS life_manager_records (
      owner_email TEXT NOT NULL, record_type TEXT NOT NULL, record_id TEXT NOT NULL,
      payload_json TEXT, version INTEGER NOT NULL DEFAULT 1, sequence INTEGER NOT NULL,
      client_updated_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
      updated_by TEXT NOT NULL, PRIMARY KEY (owner_email, record_type, record_id)
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS life_manager_records_owner_sequence ON life_manager_records (owner_email, sequence)"),
    database.prepare(`CREATE TABLE IF NOT EXISTS life_manager_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, owner_email TEXT NOT NULL,
      record_type TEXT NOT NULL, record_id TEXT NOT NULL, payload_json TEXT,
      version INTEGER NOT NULL, client_updated_at TEXT NOT NULL, deleted_at TEXT,
      outcome TEXT NOT NULL, archived_at TEXT NOT NULL, archived_by TEXT NOT NULL
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS life_manager_history_owner_archived ON life_manager_history (owner_email, id DESC)"),
    database.prepare(`CREATE TABLE IF NOT EXISTS life_manager_photos (
      owner_email TEXT NOT NULL, photo_id TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL, content_type TEXT NOT NULL, byte_size INTEGER NOT NULL,
      sha256 TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      deleted_at TEXT, PRIMARY KEY (owner_email, photo_id)
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS life_manager_photos_owner_hash ON life_manager_photos (owner_email, sha256)")
  ]);
};

const bytesToHex = (bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
export const sha256 = async (value) => bytesToHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
export const sha256Bytes = async (value) => bytesToHex(await crypto.subtle.digest("SHA-256", value));

export const randomToken = (bytes = 32) => {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

export const normalizeUserCode = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);

export const parseLifeManagerJson = async (request, maxBytes = 1_500_000) => {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
    throw json({ error: "Content-Type must be application/json" }, 415);
  }
  const text = await request.text();
  if (text.length > maxBytes) throw json({ error: "Request is too large" }, 413);
  try { return JSON.parse(text); }
  catch { throw json({ error: "Request contains invalid JSON" }, 400); }
};

export const validateRecord = (input) => {
  const type = String(input?.type || "");
  const id = String(input?.id || "").trim();
  if (!allowedRecordTypes.has(type)) throw json({ error: "Unsupported record type" }, 400);
  if (!id || id.length > 160) throw json({ error: "Invalid record id" }, 400);
  const payload = input.payload == null ? null : input.payload;
  const payloadJson = payload == null ? null : JSON.stringify(payload);
  if (payloadJson && payloadJson.length > 900_000) throw json({ error: "Record is too large" }, 413);
  const clientUpdatedAt = new Date(input.updatedAt || Date.now());
  if (Number.isNaN(clientUpdatedAt.valueOf())) throw json({ error: "Invalid updatedAt" }, 400);
  return {
    type,
    id,
    payload,
    payloadJson,
    baseVersion: Math.max(0, Number(input.baseVersion || 0)),
    clientUpdatedAt: clientUpdatedAt.toISOString(),
    deletedAt: input.deletedAt ? new Date(input.deletedAt).toISOString() : null
  };
};

export const authenticateLifeManagerDevice = async (context) => {
  const authorization = context.request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return { response: json({ error: "Device authentication required" }, 401) };
  const token = authorization.slice(7).trim();
  if (token.length < 32) return { response: json({ error: "Invalid device token" }, 401) };
  const pepper = String(context.env.LIFE_MANAGER_TOKEN_PEPPER || "");
  if (!pepper) return { response: json({ error: "Life Manager cloud is not configured" }, 503) };
  await ensureLifeManagerSchema(context.env.SCHEDULER_DB);
  const tokenHash = await sha256(`${token}:${pepper}`);
  const device = await context.env.SCHEDULER_DB.prepare(
    "SELECT owner_email, device_id, device_name FROM life_manager_devices WHERE token_hash = ? AND revoked_at IS NULL"
  ).bind(tokenHash).first();
  if (!device) return { response: json({ error: "Device token is invalid or revoked" }, 401) };
  await context.env.SCHEDULER_DB.prepare(
    "UPDATE life_manager_devices SET last_seen_at = ? WHERE owner_email = ? AND device_id = ?"
  ).bind(new Date().toISOString(), device.owner_email, device.device_id).run();
  return { device };
};

const nextCursor = async (database, ownerEmail) => {
  await database.prepare(
    "INSERT INTO life_manager_sync_cursors (owner_email, cursor) VALUES (?, 0) ON CONFLICT(owner_email) DO NOTHING"
  ).bind(ownerEmail).run();
  const row = await database.prepare(
    "UPDATE life_manager_sync_cursors SET cursor = cursor + 1 WHERE owner_email = ? RETURNING cursor"
  ).bind(ownerEmail).first();
  return Number(row?.cursor || 0);
};

const archiveRecord = async (database, ownerEmail, row, outcome, actor) => {
  if (!row) return;
  await database.prepare(
    `INSERT INTO life_manager_history
      (owner_email, record_type, record_id, payload_json, version, client_updated_at, deleted_at, outcome, archived_at, archived_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(ownerEmail, row.record_type, row.record_id, row.payload_json, row.version,
    row.client_updated_at, row.deleted_at, outcome, new Date().toISOString(), actor).run();
};

export const applyRecordChange = async (database, ownerEmail, rawChange, actor) => {
  const change = validateRecord(rawChange);
  const current = await database.prepare(
    "SELECT * FROM life_manager_records WHERE owner_email = ? AND record_type = ? AND record_id = ?"
  ).bind(ownerEmail, change.type, change.id).first();
  const conflict = Boolean(current && change.baseVersion !== Number(current.version));
  if (conflict) {
    const clientWins = change.clientUpdatedAt > String(current.client_updated_at || "");
    if (!clientWins) {
      await archiveRecord(database, ownerEmail, {
        record_type: change.type,
        record_id: change.id,
        payload_json: change.payloadJson,
        version: change.baseVersion,
        client_updated_at: change.clientUpdatedAt,
        deleted_at: change.deletedAt
      }, "conflict", actor);
      return { accepted: false, conflict: true, record: serializeRecord(current) };
    }
    await archiveRecord(database, ownerEmail, current, "conflict", actor);
  } else if (current) {
    await archiveRecord(database, ownerEmail, current, "replaced", actor);
  }
  const sequence = await nextCursor(database, ownerEmail);
  const version = Number(current?.version || 0) + 1;
  const now = new Date().toISOString();
  await database.prepare(
    `INSERT INTO life_manager_records
      (owner_email, record_type, record_id, payload_json, version, sequence, client_updated_at, updated_at, deleted_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_email, record_type, record_id) DO UPDATE SET
       payload_json = excluded.payload_json, version = excluded.version, sequence = excluded.sequence,
       client_updated_at = excluded.client_updated_at, updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at, updated_by = excluded.updated_by`
  ).bind(ownerEmail, change.type, change.id, change.payloadJson, version, sequence,
    change.clientUpdatedAt, now, change.deletedAt, actor).run();
  return {
    accepted: true,
    conflict,
    record: { ...change, version, sequence, serverUpdatedAt: now }
  };
};

export const serializeRecord = (row) => ({
  type: row.record_type,
  id: row.record_id,
  payload: row.payload_json ? JSON.parse(row.payload_json) : null,
  version: Number(row.version),
  sequence: Number(row.sequence),
  updatedAt: row.client_updated_at,
  serverUpdatedAt: row.updated_at,
  deletedAt: row.deleted_at || null
});

export const recordsSince = async (database, ownerEmail, cursor = 0) => {
  const result = await database.prepare(
    "SELECT * FROM life_manager_records WHERE owner_email = ? AND sequence > ? ORDER BY sequence ASC LIMIT 2000"
  ).bind(ownerEmail, Math.max(0, Number(cursor || 0))).all();
  const cursorRow = await database.prepare(
    "SELECT cursor FROM life_manager_sync_cursors WHERE owner_email = ?"
  ).bind(ownerEmail).first();
  return {
    cursor: Number(cursorRow?.cursor || 0),
    records: (result.results || []).map(serializeRecord)
  };
};

export const lifeManagerErrorResponse = (error) => {
  if (error instanceof Response) return error;
  console.error("Life Manager cloud error", error);
  return json({ error: "Life Manager cloud service failed" }, 500);
};
