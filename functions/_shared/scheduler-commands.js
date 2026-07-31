// Pure command execution for the TH Operations Scheduler.  This module has no
// request or database dependency so its validation and target resolution can be
// exercised locally before a command is allowed to touch a private schedule.

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATUSES = new Set(["assigned", "escort", "open", "blank", "blocked", "sick", "pto", "training"]);
const STAFF_STATUSES = new Set(["assigned", "escort", "sick", "pto", "training"]);
const MAX_TEXT = 4_000;

export class SchedulerCommandError extends Error {
  constructor(code, message, details = undefined, status = 400) {
    super(message);
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

const fail = (code, message, details, status) => {
  throw new SchedulerCommandError(code, message, details, status);
};
const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
const clone = (value) => JSON.parse(JSON.stringify(value));
const key = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
const text = (value, field, { required = false, max = MAX_TEXT } = {}) => {
  if (value == null || value === "") {
    if (required) fail("required_field", `${field} is required`, { field });
    return "";
  }
  if (typeof value !== "string") fail("invalid_field", `${field} must be a string`, { field });
  const result = value.trim().replace(/\s+/g, " ");
  if (required && !result) fail("required_field", `${field} is required`, { field });
  if (result.length > max) fail("invalid_field", `${field} is too long`, { field, max });
  return result;
};
const isoDate = (value, field = "target.date") => {
  const date = text(value, field, { required: true, max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    fail("invalid_date", `${field} must be an ISO date (YYYY-MM-DD)`, { field });
  }
  return date;
};
const dayFor = (date) => DAYS[new Date(`${date}T12:00:00Z`).getUTCDay() === 0 ? 6 : new Date(`${date}T12:00:00Z`).getUTCDay() - 1];
const time = (value, field) => {
  const normalized = text(value, field, { required: true, max: 5 }).replace(/:/g, "");
  if (!/^([01]\d|2[0-3])[0-5]\d$/.test(normalized)) {
    fail("invalid_time", `${field} must be HHMM or HH:MM (24-hour)`, { field });
  }
  return normalized;
};
const mondayFor = (date) => {
  const value = new Date(`${date}T12:00:00Z`);
  const day = value.getUTCDay();
  value.setUTCDate(value.getUTCDate() - (day === 0 ? 6 : day - 1));
  return value.toISOString().slice(0, 10);
};
const weekDates = (date) => {
  const monday = new Date(`${mondayFor(date)}T12:00:00Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const copy = new Date(monday);
    copy.setUTCDate(copy.getUTCDate() + index);
    return copy.toISOString().slice(0, 10);
  });
};
const blank = () => ({ status: "blank", name: "", start: "", end: "", note: "" });
const publicTarget = (target) => ({
  rowId: target.row.id,
  site: target.row.site,
  post: target.row.post,
  shift: target.row.shiftCode || target.row.shiftName || "",
  date: target.date,
  mode: target.mode
});
const assignmentResult = (target, assignment) => ({
  ...publicTarget(target),
  assignment: {
    status: assignment.status || "blank",
    officer: assignment.name || "",
    position: assignment.position || target.row.post || "",
    start: assignment.start || "",
    end: assignment.end || "",
    tagged: assignment.tagged === true,
    note: assignment.note || ""
  }
});

const assignmentAt = (target, create = true) => {
  const collectionName = target.mode === "master" ? "master" : "assignments";
  const collection = target.row[collectionName] || (target.row[collectionName] = {});
  if (!collection[target.assignmentKey] && create) collection[target.assignmentKey] = blank();
  return collection[target.assignmentKey] || blank();
};

const requireConfirmation = (command, action, options = {}) => {
  if (command.confirm !== true && options.confirmed !== true) {
    fail("confirmation_required", `${action} requires confirm: true`, { field: "confirm" }, 409);
  }
};

const assignmentCollections = [
  { name: "assignments", mode: "working" },
  { name: "master", mode: "master" }
];
const rowMetadata = (row = {}) => {
  const { assignments, master, agentTagged, ...metadata } = row;
  return metadata;
};
const tagReportTarget = (row, key, mode) => ({
  rowId: row.id,
  site: row.site || "",
  post: row.post || "",
  shift: row.shiftCode || row.shiftName || "",
  ...(key ? (mode === "working" ? { date: key, mode } : { day: key, mode }) : { scope: "row" })
});

// Direct command requests are the agent execution boundary. Mark only the
// state they changed here, after normal validation succeeds, so manual UI
// edits keep their existing tagging behavior.
const markAgentChanges = (before, after) => {
  const tagged = [];
  const cleared = [];
  const seen = new Set();
  const add = (collection, target) => {
    const id = `${target.rowId || target.scope}:${target.mode || target.scope}:${target.date || target.day || ""}`;
    if (!seen.has(id)) {
      seen.add(id);
      collection.push(target);
    }
  };
  const beforeRows = new Map((before.rows || []).map((row) => [String(row.id), row]));
  for (const row of after.rows || []) {
    const previous = beforeRows.get(String(row.id));
    if (!previous || JSON.stringify(rowMetadata(previous)) !== JSON.stringify(rowMetadata(row))) {
      row.agentTagged = true;
      add(tagged, tagReportTarget(row));
    }
    if (!previous) continue;
    for (const { name, mode } of assignmentCollections) {
      const priorAssignments = previous[name] || {};
      const nextAssignments = row[name] || {};
      for (const assignmentKey of new Set([...Object.keys(priorAssignments), ...Object.keys(nextAssignments)])) {
        const prior = priorAssignments[assignmentKey] || blank();
        const next = nextAssignments[assignmentKey];
        if (!next || JSON.stringify(prior) === JSON.stringify(next)) continue;
        const target = tagReportTarget(row, assignmentKey, mode);
        const explicitCleanup = next._skipAgentTag === true;
        delete next._skipAgentTag;
        if (explicitCleanup) {
          add(cleared, target);
          continue;
        }
        next.tagged = true;
        add(tagged, target);
      }
    }
  }
  if (JSON.stringify(before.staff || []) !== JSON.stringify(after.staff || [])) {
    add(tagged, { scope: "roster" });
  }
  return {
    automatic: true,
    total: tagged.length,
    tagged: tagged.slice(0, 100),
    truncated: tagged.length > 100,
    totalCleared: cleared.length,
    cleared: cleared.slice(0, 100),
    clearedTruncated: cleared.length > 100
  };
};

const targetCandidates = (state, rawTarget) => {
  if (!isObject(rawTarget)) fail("required_field", "target is required", { field: "target" });
  const mode = rawTarget.mode == null ? "working" : text(rawTarget.mode, "target.mode", { required: true, max: 12 }).toLowerCase();
  if (mode !== "working" && mode !== "master") fail("invalid_field", "target.mode must be working or master", { field: "target.mode" });
  const date = isoDate(rawTarget.date);
  const assignmentKey = mode === "master" ? dayFor(date) : date;
  const rowId = text(rawTarget.rowId, "target.rowId", { max: 200 });
  const site = text(rawTarget.site, "target.site", { max: 200 });
  const post = text(rawTarget.post, "target.post", { max: 300 });
  const shift = text(rawTarget.shift, "target.shift", { max: 200 });
  const officer = text(rawTarget.officer, "target.officer", { max: 200 });
  if (!rowId && (!site || !post)) {
    fail("required_field", "target requires rowId or both site and post", { fields: ["target.rowId", "target.site", "target.post"] });
  }

  let rows = Array.isArray(state.rows) ? state.rows.slice() : [];
  if (rowId) rows = rows.filter((row) => String(row.id) === rowId);
  if (site) rows = rows.filter((row) => key(row.site) === key(site));
  if (post) rows = rows.filter((row) => key(row.post) === key(post));
  if (shift) rows = rows.filter((row) => key(row.shiftCode) === key(shift) || key(row.shiftName) === key(shift));
  if (officer) rows = rows.filter((row) => key(assignmentAt({ row, mode, assignmentKey }, false).name) === key(officer));
  if (!rows.length) fail("target_not_found", "No schedule cell matches target", { target: rawTarget }, 404);
  if (rows.length > 1) {
    fail("ambiguous_target", "Target matches multiple schedule rows; include rowId or shift", {
      matches: rows.slice(0, 10).map((row) => ({ rowId: row.id, site: row.site, post: row.post, shift: row.shiftCode || row.shiftName || "" }))
    }, 409);
  }
  return { row: rows[0], mode, date, assignmentKey };
};

const resolveOfficer = (state, rawName, allowNew = false) => {
  const requested = text(rawName, "officer", { required: true, max: 200 });
  state.staff = Array.isArray(state.staff) ? state.staff : [];
  state.removedStaff = Array.isArray(state.removedStaff) ? state.removedStaff : [];
  const removed = new Set(state.removedStaff.map(key));
  const matches = state.staff.filter((name) => key(name) === key(requested) && !removed.has(key(name)));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) fail("ambiguous_officer", "Officer name is ambiguous", { officer: requested }, 409);
  if (!allowNew) fail("officer_not_found", "Officer is not in the active roster; set allowNewOfficer to true to add them", { officer: requested }, 404);
  state.staff.push(requested);
  state.staff.sort((a, b) => String(a).localeCompare(String(b)));
  state.removedStaff = state.removedStaff.filter((name) => key(name) !== key(requested));
  return requested;
};

const applyStatus = (assignment, status, officer) => {
  if (!STATUSES.has(status)) fail("invalid_status", "Unsupported assignment status", { status, allowed: [...STATUSES] });
  assignment.status = status;
  if (STAFF_STATUSES.has(status)) {
    if (officer !== undefined) assignment.name = officer;
  } else {
    assignment.name = "";
  }
  if (status === "open") assignment.note = "OPEN";
  if (status === "blank" || status === "blocked") {
    assignment.name = "";
    assignment.start = "";
    assignment.end = "";
    assignment.note = "";
    delete assignment.tagged;
  }
};

const requireEditable = (assignment) => {
  if (assignment.status === "blank" || assignment.status === "blocked") {
    fail("invalid_state", "This command cannot modify a blank or blocked cell; use update_assignment or set_status first");
  }
};

const executeOne = (state, command, options = {}) => {
  if (!isObject(command)) fail("required_field", "command must be an object", { field: "command" });
  const kind = text(command.kind, "command.kind", { required: true, max: 64 }).toLowerCase();
  if (kind === "save" || kind === "sync") return { changed: false, result: { kind, synchronized: true } };
  if (kind === "batch") {
    if (!Array.isArray(command.commands) || !command.commands.length || command.commands.length > 50) {
      fail("invalid_field", "batch.commands must contain 1 to 50 commands", { field: "command.commands" });
    }
    const results = command.commands.map((item) => executeOne(state, item, {
      inBatch: true,
      confirmed: command.confirm === true || options.confirmed === true
    }).result);
    return { changed: true, result: { kind, commands: results } };
  }

  if (kind === "add_officer") {
    const officer = resolveOfficer(state, command.officer, true);
    return { changed: true, result: { kind, officer } };
  }
  if (kind === "remove_officer") {
    requireConfirmation(command, "remove_officer", options);
    const officer = text(command.officer, "officer", { required: true, max: 200 });
    const found = state.staff?.find((name) => key(name) === key(officer));
    if (!found) fail("officer_not_found", "Officer is not in the roster", { officer }, 404);
    state.staff = state.staff.filter((name) => key(name) !== key(found));
    state.removedStaff = Array.isArray(state.removedStaff) ? state.removedStaff : [];
    if (!state.removedStaff.some((name) => key(name) === key(found))) state.removedStaff.push(found);
    return { changed: true, result: { kind, officer: found } };
  }
  if (kind === "rollover_master") {
    requireConfirmation(command, "rollover_master", options);
    const date = isoDate(command.date, "date");
    const dates = weekDates(date);
    for (const row of state.rows) {
      row.assignments = row.assignments || {};
      row.master = row.master || {};
      for (const workingDate of dates) row.assignments[workingDate] = clone(row.master[dayFor(workingDate)] || blank());
    }
    return { changed: true, result: { kind, weekStart: dates[0], rowsUpdated: state.rows.length } };
  }
  if (kind === "clear_week") {
    requireConfirmation(command, "clear_week", options);
    const date = isoDate(command.date, "date");
    const mode = command.mode == null ? "working" : text(command.mode, "mode", { required: true, max: 12 }).toLowerCase();
    if (mode !== "working" && mode !== "master") fail("invalid_field", "mode must be working or master", { field: "mode" });
    const site = text(command.site, "site", { max: 200 });
    const dates = mode === "master" ? DAYS : weekDates(date);
    const rows = state.rows.filter((row) => !site || key(row.site) === key(site));
    if (!rows.length) fail("target_not_found", "No schedule rows match site", { site }, 404);
    for (const row of rows) {
      const collection = mode === "master" ? (row.master || (row.master = {})) : (row.assignments || (row.assignments = {}));
      for (const assignmentKey of dates) collection[assignmentKey] = blank();
    }
    return { changed: true, result: { kind, mode, weekStart: mondayFor(date), site: site || "all", rowsUpdated: rows.length } };
  }

  const target = targetCandidates(state, command.target);
  const assignment = assignmentAt(target);
  if (kind === "set_row_post") {
    const post = text(command.post, "post", { required: true, max: 300 });
    target.row.post = post;
    return { changed: true, result: { kind, ...publicTarget(target), post } };
  }
  if (kind === "hide_row" || kind === "show_row") {
    if (target.mode === "master") {
      target.row.masterHidden = kind === "hide_row";
    } else {
      const weekStart = mondayFor(target.date);
      const hiddenWeeks = new Set(Array.isArray(target.row.hiddenWeeks) ? target.row.hiddenWeeks : []);
      if (kind === "hide_row") hiddenWeeks.add(weekStart);
      else hiddenWeeks.delete(weekStart);
      target.row.hiddenWeeks = [...hiddenWeeks].sort();
    }
    return { changed: true, result: { kind, ...publicTarget(target), hidden: kind === "hide_row" } };
  }
  if (kind === "insert_row") {
    const source = clone(target.row);
    const requestedId = text(command.rowId, "rowId", { max: 200 });
    const id = requestedId || `${String(source.site || "row").replace(/[^a-z0-9]+/gi, "-")}-${Date.now()}`;
    if (state.rows.some((row) => String(row.id) === id)) fail("duplicate_row", "rowId already exists", { rowId: id }, 409);
    source.id = id;
    source.typeNum = Number.isSafeInteger(command.typeNum) && command.typeNum > 0 ? command.typeNum : Number(source.typeNum || 0) + 1;
    source.typeLabel = command.typeLabel == null ? `${source.typeNum}\nNormal` : text(command.typeLabel, "typeLabel", { required: true, max: 100 });
    source.assignments = {};
    source.master = {};
    for (const workingDate of weekDates(target.date)) source.assignments[workingDate] = blank();
    for (const day of DAYS) source.master[day] = blank();
    if (target.mode === "working") {
      source.scope = "working-week";
      source.weekStart = mondayFor(target.date);
    } else {
      source.scope = "master-only";
      delete source.weekStart;
    }
    const index = state.rows.indexOf(target.row);
    state.rows.splice(index + 1, 0, source);
    return { changed: true, result: { kind, rowId: id, after: publicTarget(target), mode: target.mode } };
  }
  if (kind === "assign") {
    const officer = resolveOfficer(state, command.officer, command.allowNewOfficer === true);
    applyStatus(assignment, "assigned", officer);
    if (command.start != null) assignment.start = time(command.start, "start");
    if (command.end != null) assignment.end = time(command.end, "end");
    if (command.position != null) assignment.position = text(command.position, "position", { required: true, max: 300 });
    if (command.note != null) assignment.note = text(command.note, "note");
    return { changed: true, result: { kind, ...assignmentResult(target, assignment) } };
  }
  if (kind === "unassign") {
    assignment.status = "open";
    assignment.name = "";
    assignment.note = "OPEN";
    return { changed: true, result: { kind, ...assignmentResult(target, assignment) } };
  }
  if (kind === "set_time") {
    requireEditable(assignment);
    if (command.start == null && command.end == null) fail("required_field", "set_time requires start or end", { fields: ["start", "end"] });
    if (command.start != null) assignment.start = time(command.start, "start");
    if (command.end != null) assignment.end = time(command.end, "end");
    return { changed: true, result: { kind, ...assignmentResult(target, assignment) } };
  }
  if (kind === "set_status") {
    const status = text(command.status, "status", { required: true, max: 32 }).toLowerCase();
    let officer;
    if (STAFF_STATUSES.has(status) && command.officer != null) officer = resolveOfficer(state, command.officer, command.allowNewOfficer === true);
    applyStatus(assignment, status, officer);
    return { changed: true, result: { kind, ...assignmentResult(target, assignment) } };
  }
  if (kind === "set_note") {
    requireEditable(assignment);
    assignment.note = text(command.note, "note", { max: MAX_TEXT });
    return { changed: true, result: { kind, ...assignmentResult(target, assignment) } };
  }
  if (kind === "tag" || kind === "untag") {
    requireEditable(assignment);
    assignment.tagged = kind === "tag";
    // An explicit tag-cleanup request is the intentional exception to the
    // automatic agent marker. It enables one batch to retain only the tags
    // the caller selected, without UI-by-UI clicking.
    if (kind === "untag") assignment._skipAgentTag = true;
    return { changed: true, result: { kind, ...assignmentResult(target, assignment) } };
  }
  if (kind === "update_assignment") {
    if (!isObject(command.patch)) fail("required_field", "update_assignment requires patch", { field: "patch" });
    const patch = command.patch;
    const fields = ["status", "officer", "start", "end", "position", "note", "tagged"];
    const allowedPatchFields = [...fields, "allowNewOfficer"];
    const unsupported = Object.keys(patch).filter((field) => !allowedPatchFields.includes(field));
    if (unsupported.length) fail("invalid_field", "patch contains unsupported fields", { unsupported, allowed: allowedPatchFields });
    if (!Object.keys(patch).some((field) => fields.includes(field))) fail("invalid_field", "patch contains no supported assignment fields", { allowed: fields });
    const nextStatus = patch.status == null ? assignment.status : text(patch.status, "patch.status", { required: true, max: 32 }).toLowerCase();
    let officer;
    if (patch.officer != null) officer = resolveOfficer(state, patch.officer, patch.allowNewOfficer === true);
    applyStatus(assignment, nextStatus, officer);
    if (patch.start != null) assignment.start = time(patch.start, "patch.start");
    if (patch.end != null) assignment.end = time(patch.end, "patch.end");
    if (patch.position != null) assignment.position = text(patch.position, "patch.position", { required: true, max: 300 });
    if (patch.note != null) assignment.note = text(patch.note, "patch.note");
    if (patch.tagged != null) {
      if (typeof patch.tagged !== "boolean") fail("invalid_field", "patch.tagged must be boolean", { field: "patch.tagged" });
      requireEditable(assignment);
      assignment.tagged = patch.tagged;
    }
    return { changed: true, result: { kind, ...assignmentResult(target, assignment) } };
  }
  if (kind === "clear") {
    requireConfirmation(command, "clear", options);
    Object.assign(assignment, blank());
    delete assignment.tagged;
    return { changed: true, result: { kind, ...assignmentResult(target, assignment) } };
  }
  if (kind === "block") {
    requireConfirmation(command, "block", options);
    Object.assign(assignment, { status: "blocked", name: "", start: "", end: "", note: "" });
    delete assignment.tagged;
    return { changed: true, result: { kind, ...assignmentResult(target, assignment) } };
  }
  fail("unsupported_command", "Unsupported scheduler command", { kind });
};

export const executeSchedulerCommand = (rawState, command) => {
  if (!isObject(rawState) || !Array.isArray(rawState.rows) || !Array.isArray(rawState.staff)) {
    fail("invalid_state", "Schedule state is invalid");
  }
  const state = clone(rawState);
  const execution = executeOne(state, command);
  const agentTags = execution.changed ? markAgentChanges(rawState, state) : null;
  return {
    state,
    changed: execution.changed,
    result: execution.changed ? { ...execution.result, agentTags } : execution.result
  };
};
