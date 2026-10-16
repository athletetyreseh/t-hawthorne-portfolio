import { json, ownerEmailFor, parseJson } from "./private-access.js";
import { cleanText, ensureOfficerScheduleSchema, loadSchedulerState, loadStaffDirectory, namesFromSchedule, overtimeRequestFromRow } from "./officer-schedule.js";
import { serializeValidatedState, pruneHistory } from "./scheduler.js";

const normalizedName = (value) => cleanText(value, 120).toLowerCase();
const fail = (message, status = 409) => { throw json({ error: message }, status); };

export const isOvertimePreview = (context) => context.env?.CF_PAGES_BRANCH === "visual-improvements" || new URL(context.request.url).hostname.endsWith(".t-hawthorne-portfolio.pages.dev");

const mondayFor = (date) => {
  const day = new Date(date + "T12:00:00Z");
  if (!Number.isFinite(day.getTime())) return "";
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
};

const timeMinutes = (value) => {
  const digits = String(value || "").replace(":", "");
  if (!/^\d{3,4}$/.test(digits)) return null;
  const text = digits.padStart(4, "0");
  const hours = Number(text.slice(0, 2)), minutes = Number(text.slice(2));
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
};
const timeText = (minutes) => String(Math.floor(minutes / 60)).padStart(2, "0") + String(minutes % 60).padStart(2, "0");
const intervalFor = (date, start, end) => {
  const first = timeMinutes(start), last = timeMinutes(end);
  if (first == null || last == null || first === last) return null;
  const midnight = Date.parse(date + "T00:00:00-07:00");
  if (!Number.isFinite(midnight)) return null;
  return { start: midnight + first * 60000, end: midnight + (last <= first ? last + 1440 : last) * 60000 };
};
const visibleRow = (state, row, date) => {
  const week = mondayFor(date);
  if (!week || row.scope === "master-only") return false;
  if (row.scope === "working-week" && row.weekStart !== week) return false;
  if ((row.hiddenWeeks || []).includes(week)) return false;
  const hidden = state.hiddenRowsByScope?.[week] || {};
  const baseKey = [row.site, row.shiftName, row.post, row.shiftCode, row.typeNum].join("|");
  return !hidden[row.id] && !hidden[baseKey];
};

// Only an explicit red/open, unnamed, published cell can be requested.
export const findOpenOvertimeShift = (state, rowId, date, now = Date.now()) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("Choose a valid shift date.", 400);
  const row = (state?.rows || []).find((item) => item.id === rowId);
  const cell = row?.assignments?.[date];
  if (!row || !visibleRow(state, row, date) || cell?.status !== "open" || cleanText(cell.name, 120)) fail("This shift is no longer unassigned. Refresh the available shifts.");
  const fallback = String(row.time || "").split(/[-–]/);
  const start = timeMinutes(cell.start || fallback[0]);
  const end = timeMinutes(cell.end || fallback[1]);
  if (start == null || end == null || start === end) fail("This shift needs valid start and end times before it can be requested.");
  const interval = intervalFor(date, timeText(start), timeText(end));
  if (!interval || interval.end <= now) fail("This shift has already ended.");
  return { row, cell, date, start: timeText(start), end: timeText(end), interval, site: row.site || "", post: cell.position || row.post || "", shiftName: row.shiftName || "" };
};

export async function submitOvertimeRequest(context) {
  const database = context.env.SCHEDULER_DB;
  await ensureOfficerScheduleSchema(database);
  const body = await parseJson(context.request, 10000);
  const rowId = cleanText(body.rowId, 240), date = cleanText(body.date, 10);
  const requestedName = cleanText(body.officerName, 120);
  if (!rowId || !requestedName) fail("Choose a shift and your name.", 400);
  const snapshot = await loadSchedulerState(database, ownerEmailFor(context));
  if (!snapshot.state) fail("The published schedule is unavailable.");
  const shift = findOpenOvertimeShift(snapshot.state, rowId, date);
  const directory = await loadStaffDirectory(database);
  const names = [...namesFromSchedule(snapshot.state), ...directory.staff.map((person) => cleanText(person.full_name, 120))];
  const name = names.find((item) => normalizedName(item) === normalizedName(requestedName));
  if (!name) fail("Choose a name from the current officer list.", 400);
  const record = {
    id: crypto.randomUUID(), owner_email: snapshot.ownerEmail, row_id: rowId,
    shift_date: date, site: shift.site, post: shift.post, shift_name: shift.shiftName,
    start_time: shift.start, end_time: shift.end, officer_name: name,
    officer_email: directory.byName.get(normalizedName(name)) || "",
    message: cleanText(body.notes, 1000), status: "pending", denial_message: "",
    created_at: new Date().toISOString(), resolved_at: null, resolved_by: ""
  };
  // Branch previews exercise validation and confirmation without creating live requests.
  if (isOvertimePreview(context)) return json({ ok: true, preview: true, request: overtimeRequestFromRow(record, true) }, 201);
  await database.prepare("INSERT OR IGNORE INTO officer_schedule_overtime_requests (id, owner_email, row_id, shift_date, site, post, shift_name, start_time, end_time, officer_name, officer_email, message, status, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ? WHERE EXISTS (SELECT 1 FROM scheduler_state WHERE owner_email = ? AND revision = ?)").bind(record.id, record.owner_email, rowId, date, record.site, record.post, record.shift_name, record.start_time, record.end_time, name, record.officer_email, record.message, record.created_at, record.owner_email, snapshot.revision).run();
  const saved = await database.prepare("SELECT * FROM officer_schedule_overtime_requests WHERE owner_email = ? AND row_id = ? AND shift_date = ? AND officer_name = ? AND status = 'pending' LIMIT 1").bind(record.owner_email, rowId, date, name).first();
  if (!saved) fail("The request could not be saved. Please retry.");
  return json({ ok: true, request: overtimeRequestFromRow(saved, true) }, 201);
}

const hasAssignmentConflict = (state, request, shift) => {
  for (const row of state.rows || []) {
    for (const [date, cell] of Object.entries(row.assignments || {})) {
      if (normalizedName(cell.name) !== normalizedName(request.officer_name) || ["blank", "blocked", "open"].includes(cell.status || "blank") || !visibleRow(state, row, date)) continue;
      const other = intervalFor(date, cell.start, cell.end);
      if (other && shift.interval.start < other.end && other.start < shift.interval.end) return true;
    }
  }
  return false;
};

export async function resolveOvertimeRequest(context, request, status, denialMessage) {
  if (isOvertimePreview(context)) return json({ error: "The preview cannot approve or change live assignments." }, 403);
  if (request.status !== "pending") return json({ error: "This request has already been reviewed." }, 409);
  const database = context.env.SCHEDULER_DB, owner = context.data.schedulerUser;
  const now = new Date().toISOString(), reviewer = context.data.privateUser?.email || owner;
  if (status === "denied") {
    const result = await database.prepare("UPDATE officer_schedule_overtime_requests SET status = 'denied', denial_message = ?, resolved_at = ?, resolved_by = ? WHERE id = ? AND owner_email = ? AND status = 'pending'").bind(denialMessage, now, reviewer, request.id, owner).run();
    return result.meta?.changes ? json({ ok: true }) : json({ error: "This request was already reviewed." }, 409);
  }
  const current = await database.prepare("SELECT state_json, revision, updated_at FROM scheduler_state WHERE owner_email = ?").bind(owner).first();
  if (!current) fail("The cloud schedule is unavailable.");
  const state = JSON.parse(current.state_json);
  const shift = findOpenOvertimeShift(state, request.row_id, request.shift_date);
  if (shift.start !== request.start_time || shift.end !== request.end_time || shift.site !== request.site || shift.post !== request.post) fail("The shift details changed after this request. Review a new request for the updated shift.");
  if (hasAssignmentConflict(state, request, shift)) fail("This officer already has an overlapping assignment, including an overnight shift.");
  const timeOff = await database.prepare("SELECT id FROM officer_schedule_requests WHERE owner_email = ? AND lower(officer_name) = lower(?) AND request_type IN ('pto', 'unpaid') AND status = 'approved' AND start_date <= ? AND end_date >= ? LIMIT 1").bind(owner, request.officer_name, request.shift_date, request.shift_date).first();
  if (timeOff) fail("This officer has approved time off on that date.");
  shift.row.assignments[request.shift_date] = { ...shift.cell, status: "assigned", name: request.officer_name, start: shift.start, end: shift.end, note: request.message || "Overtime pickup", overtimeRequestId: request.id };
  const serialized = serializeValidatedState(state), revision = Number(current.revision) + 1;
  // D1 batch is atomic: revision comparison, assignment, request approval, and history move together.
  const results = await database.batch([
    database.prepare("INSERT INTO scheduler_history (owner_email, revision, state_json, created_at) SELECT owner_email, revision, state_json, ? FROM scheduler_state WHERE owner_email = ? AND revision = ? AND EXISTS (SELECT 1 FROM officer_schedule_overtime_requests WHERE id = ? AND owner_email = ? AND status = 'pending')").bind(now, owner, current.revision, request.id, owner),
    database.prepare("UPDATE scheduler_state SET state_json = ?, revision = ?, updated_at = ? WHERE owner_email = ? AND revision = ? AND EXISTS (SELECT 1 FROM officer_schedule_overtime_requests WHERE id = ? AND owner_email = ? AND status = 'pending')").bind(serialized, revision, now, owner, current.revision, request.id, owner),
    database.prepare("UPDATE officer_schedule_overtime_requests SET status = 'approved', denial_message = '', resolved_at = ?, resolved_by = ? WHERE id = ? AND owner_email = ? AND status = 'pending' AND EXISTS (SELECT 1 FROM scheduler_state WHERE owner_email = ? AND revision = ? AND state_json = ?)").bind(now, reviewer, request.id, owner, owner, revision, serialized),
    database.prepare("UPDATE officer_schedule_overtime_requests SET status = 'denied', denial_message = 'The shift was assigned to another officer.', resolved_at = ?, resolved_by = ? WHERE owner_email = ? AND row_id = ? AND shift_date = ? AND id != ? AND status = 'pending' AND EXISTS (SELECT 1 FROM officer_schedule_overtime_requests WHERE id = ? AND owner_email = ? AND status = 'approved' AND resolved_at = ?)").bind(now, reviewer, owner, request.row_id, request.shift_date, request.id, request.id, owner, now)
  ]);
  if (!results[1].meta?.changes || !results[2].meta?.changes) return json({ error: "The schedule changed while approving. Refresh and review the shift again." }, 409);
  await pruneHistory(database, owner);
  return json({ ok: true, scheduleChanged: true, revision, updatedAt: now });
}
