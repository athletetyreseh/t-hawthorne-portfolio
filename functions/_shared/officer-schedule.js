import { json, ownerEmailFor, parseJson } from "./private-access.js";

export const REQUEST_TYPES = new Set(["pto", "unpaid", "late-in", "late-out"]);
export const REQUEST_STATUSES = new Set(["pending", "approved", "denied"]);

let officerSchemaPromise = null;

export const ensureOfficerScheduleSchema = async (database) => {
  if (!officerSchemaPromise) {
    officerSchemaPromise = database.batch([
      database.prepare(`CREATE TABLE IF NOT EXISTS officer_schedule_requests (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        officer_name TEXT NOT NULL,
        officer_email TEXT NOT NULL DEFAULT '',
        request_type TEXT NOT NULL CHECK (request_type IN ('pto', 'unpaid', 'late-in', 'late-out')),
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        requested_time TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
        denial_message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by TEXT NOT NULL DEFAULT ''
      )`),
      database.prepare("CREATE INDEX IF NOT EXISTS officer_schedule_requests_owner_status ON officer_schedule_requests (owner_email, status, start_date)"),
      database.prepare("CREATE INDEX IF NOT EXISTS officer_schedule_requests_owner_dates ON officer_schedule_requests (owner_email, start_date, end_date)"),
      database.prepare(`CREATE TABLE IF NOT EXISTS officer_schedule_acknowledgements (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        officer_name TEXT NOT NULL,
        officer_email TEXT NOT NULL DEFAULT '',
        week_start TEXT NOT NULL,
        signature_data TEXT NOT NULL,
        signed_at TEXT NOT NULL
      )`),
      database.prepare("CREATE UNIQUE INDEX IF NOT EXISTS officer_schedule_ack_unique ON officer_schedule_acknowledgements (owner_email, officer_name, week_start)")
    ]).catch((error) => {
      officerSchemaPromise = null;
      throw error;
    });
  }
  return officerSchemaPromise;
};

export const cleanText = (value, max = 500) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
export const cleanEmail = (value) => cleanText(value, 200).toLowerCase();
export const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
export const isTime = (value) => value === "" || /^\d{2}:\d{2}$/.test(String(value || ""));

export const requestFromRow = (row) => ({
  id: row.id,
  officerName: row.officer_name,
  officerEmail: row.officer_email,
  type: row.request_type,
  startDate: row.start_date,
  endDate: row.end_date,
  requestedTime: row.requested_time,
  message: row.message,
  status: row.status,
  denialMessage: row.denial_message,
  createdAt: row.created_at,
  resolvedAt: row.resolved_at,
  resolvedBy: row.resolved_by
});

export const publicRequestFromRow = (row) => {
  const request = requestFromRow(row);
  request.message = "";
  request.denialMessage = "";
  request.resolvedBy = "";
  return request;
};

export const acknowledgementFromRow = (row, includeSignature = false) => ({
  id: row.id,
  officerName: row.officer_name,
  officerEmail: row.officer_email,
  weekStart: row.week_start,
  signedAt: row.signed_at,
  ...(includeSignature ? { signatureData: row.signature_data } : {})
});

export const loadSchedulerState = async (database, ownerEmail) => {
  const row = await database.prepare(
    "SELECT state_json, revision, updated_at FROM scheduler_state WHERE owner_email = ?"
  ).bind(ownerEmail).first();
  if (!row) return { state: null, revision: 0, updatedAt: "" };
  try {
    return { state: JSON.parse(row.state_json), revision: row.revision, updatedAt: row.updated_at };
  } catch {
    return { state: null, revision: row.revision, updatedAt: row.updated_at };
  }
};

export const loadStaffDirectory = async (database) => {
  const result = await database.prepare(
    "SELECT full_name, email FROM staff_records WHERE status != 'inactive' ORDER BY full_name COLLATE NOCASE"
  ).all();
  const staff = result.results || [];
  const byName = new Map(staff.map((item) => [String(item.full_name || "").trim().toLowerCase(), String(item.email || "").trim().toLowerCase()]));
  return { staff, byName };
};

export const namesFromSchedule = (state) => {
  const names = new Set();
  for (const row of state?.rows || []) {
    for (const source of [row.assignments || {}, row.master || {}]) {
      for (const assignment of Object.values(source)) {
        const name = cleanText(assignment?.name, 120);
        if (name && ["assigned", "pto", "sick", "training"].includes(assignment.status || "assigned")) names.add(name);
      }
    }
  }
  for (const name of state?.staff || []) {
    const cleaned = cleanText(name, 120);
    if (cleaned) names.add(cleaned);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
};

const publicAssignment = (assignment = {}) => ({
  status: assignment.status || "blank",
  name: cleanText(assignment.name, 120),
  start: cleanText(assignment.start, 8),
  end: cleanText(assignment.end, 8),
  position: cleanText(assignment.position, 160)
});

const publicAssignments = (assignments = {}) => Object.fromEntries(
  Object.entries(assignments).map(([key, assignment]) => [key, publicAssignment(assignment)])
);

const publicRow = (row = {}) => ({
  id: row.id,
  site: row.site || "",
  post: row.post || "",
  shiftName: row.shiftName || "",
  shiftCode: row.shiftCode || "",
  typeNum: row.typeNum || "",
  typeLabel: row.typeLabel || "",
  time: row.time || "",
  scope: row.scope || "",
  weekStart: row.weekStart || "",
  hiddenWeeks: Array.isArray(row.hiddenWeeks) ? row.hiddenWeeks : [],
  assignments: publicAssignments(row.assignments)
});

const publicState = (state) => state ? ({
  dates: state.dates || [],
  rows: (state.rows || []).map(publicRow),
  view: state.view || {},
  hiddenRowsByScope: state.hiddenRowsByScope || {}
}) : null;

export const publicSchedulePayload = async (context, includeSignature = false, includeRequestDetails = false) => {
  const database = context.env.SCHEDULER_DB;
  const ownerEmail = ownerEmailFor(context);
  await ensureOfficerScheduleSchema(database);
  const [{ state, revision, updatedAt }, directory] = await Promise.all([
    loadSchedulerState(database, ownerEmail),
    loadStaffDirectory(database)
  ]);

  const officers = namesFromSchedule(state).map((name) => ({
    name,
    email: directory.byName.get(name.toLowerCase()) || ""
  }));

  for (const person of directory.staff) {
    const name = cleanText(person.full_name, 120);
    if (name && !officers.some((officer) => officer.name.toLowerCase() === name.toLowerCase())) {
      officers.push({ name, email: cleanEmail(person.email) });
    }
  }
  officers.sort((a, b) => a.name.localeCompare(b.name));

  const requestsResult = await database.prepare(
    `SELECT * FROM officer_schedule_requests
     WHERE owner_email = ?
     ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC
     LIMIT 500`
  ).bind(ownerEmail).all();
  const acknowledgementsResult = await database.prepare(
    `SELECT * FROM officer_schedule_acknowledgements
     WHERE owner_email = ?
     ORDER BY signed_at DESC
     LIMIT 500`
  ).bind(ownerEmail).all();

  return {
    revision,
    updatedAt,
    schedule: includeRequestDetails && state ? {
      dates: state.dates || [],
      rows: state.rows || [],
      view: state.view || {},
      hiddenRowsByScope: state.hiddenRowsByScope || {}
    } : publicState(state),
    officers,
    requests: (requestsResult.results || []).map(includeRequestDetails ? requestFromRow : publicRequestFromRow),
    acknowledgements: (acknowledgementsResult.results || []).map((row) => acknowledgementFromRow(row, includeSignature))
  };
};

export const parseOfficerRequest = async (request) => {
  const body = await parseJson(request, 20_000);
  const officerName = cleanText(body.officerName, 120);
  const officerEmail = cleanEmail(body.officerEmail);
  const type = cleanText(body.type, 20);
  let startDate = cleanText(body.startDate, 10);
  let endDate = cleanText(body.endDate, 10);
  const requestedTime = cleanText(body.requestedTime, 5);
  if (!officerName) throw json({ error: "Officer name is required" }, 400);
  if (!REQUEST_TYPES.has(type)) throw json({ error: "Request type is invalid" }, 400);
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) throw json({ error: "Start and end dates are required" }, 400);
  if (endDate < startDate) [startDate, endDate] = [endDate, startDate];
  if (!isTime(requestedTime)) throw json({ error: "Requested time is invalid" }, 400);
  return {
    id: crypto.randomUUID(),
    officerName,
    officerEmail,
    type,
    startDate,
    endDate,
    requestedTime,
    message: cleanText(body.message, 1000),
    createdAt: new Date().toISOString()
  };
};

export const parseAcknowledgement = async (request) => {
  const body = await parseJson(request, 200_000);
  const officerName = cleanText(body.officerName, 120);
  const officerEmail = cleanEmail(body.officerEmail);
  const weekStart = cleanText(body.weekStart, 10);
  const signatureData = String(body.signatureData || "");
  if (!officerName) throw json({ error: "Officer name is required" }, 400);
  if (!isIsoDate(weekStart)) throw json({ error: "Week start is required" }, 400);
  if (!signatureData.startsWith("data:image/png;base64,") || signatureData.length > 180_000) {
    throw json({ error: "Signature image is invalid" }, 400);
  }
  return {
    id: crypto.randomUUID(),
    officerName,
    officerEmail,
    weekStart,
    signatureData,
    signedAt: new Date().toISOString()
  };
};
