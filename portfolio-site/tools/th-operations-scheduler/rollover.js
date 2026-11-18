const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const blank = () => ({ status: "blank", name: "", start: "", end: "", note: "" });
const clone = (value) => JSON.parse(JSON.stringify(value));
const legacyRowKey = (row = {}) =>
  [row.site, row.shiftName, row.post, row.shiftCode, row.typeNum].join("|");

const hasLegacyFlag = (map, row) =>
  Boolean(map?.[row.id] || map?.[legacyRowKey(row)]);

export function isMasterRowVisible(state, row) {
  if (!row || row.scope === "working-week" || row.scope === "history-only") return false;
  if (row.masterHidden || hasLegacyFlag(state?.hiddenRowsByScope?.master, row)) return false;
  return true;
}

export function isWorkingRowDeleted(state, row, weekStart) {
  if (!row) return true;
  if (Array.isArray(row.deletedWeeks) && row.deletedWeeks.includes(weekStart)) return true;
  if (Array.isArray(row.hiddenWeeks) && row.hiddenWeeks.includes(weekStart)) return true;
  return hasLegacyFlag(state?.hiddenRowsByScope?.[weekStart], row);
}

export function isWorkingRowVisible(state, row, weekStart) {
  if (!row || row.scope === "history-only") return false;
  if (isWorkingRowDeleted(state, row, weekStart)) return false;

  if (row.scope === "working-week") return row.weekStart === weekStart;
  if (row.scope === "master-only") {
    return Array.isArray(row.rolloverWeeks) && row.rolloverWeeks.includes(weekStart);
  }
  return true;
}

const addDeletedWeek = (row, weekStart) => {
  const deletedWeeks = new Set(Array.isArray(row.deletedWeeks) ? row.deletedWeeks : []);
  deletedWeeks.add(weekStart);
  row.deletedWeeks = [...deletedWeeks].sort();
};

const clearLegacyHiddenWeek = (row, weekStart) => {
  if (!Array.isArray(row.hiddenWeeks)) return;
  row.hiddenWeeks = row.hiddenWeeks.filter((hiddenWeek) => hiddenWeek !== weekStart);
  if (!row.hiddenWeeks.length) delete row.hiddenWeeks;
};

const historyRows = (state) => {
  if (!Array.isArray(state.historyRows)) state.historyRows = [];
  return state.historyRows;
};

const archiveRow = (state, row, archiveId, { weekStart = "", assignments = null } = {}) => {
  const history = historyRows(state);
  if (history.some((item) => item.archiveId === archiveId)) return;
  const archived = clone(row);
  archived.archivedRowId = row.id;
  archived.id = archiveId;
  archived.scope = "history-only";
  archived.archiveId = archiveId;
  archived.archivedAt = new Date().toISOString();
  if (weekStart) {
    archived.archivedWeekStart = weekStart;
    archived.master = {};
    archived.assignments = assignments || {};
  }
  history.push(archived);
};

const clearLegacyFlags = (state, row, onlyScope = null) => {
  const keys = [String(row.id || ""), legacyRowKey(row)];
  for (const [scope, entries] of Object.entries(state.hiddenRowsByScope || {})) {
    if (onlyScope !== null && scope !== onlyScope) continue;
    for (const key of keys) delete entries?.[key];
    if (entries && !Object.keys(entries).length) delete state.hiddenRowsByScope[scope];
  }
  if (state.hiddenRowsByScope && !Object.keys(state.hiddenRowsByScope).length) {
    delete state.hiddenRowsByScope;
  }
};

const archiveWorkingWeek = (state, row, weekStart, workingDates) => {
  const assignments = {};
  for (const date of workingDates) {
    if (Object.hasOwn(row.assignments || {}, date)) {
      assignments[date] = row.assignments[date];
      delete row.assignments[date];
    }
  }
  if (Object.keys(assignments).length) {
    archiveRow(state, row, `working:${row.id}:${weekStart}`, { weekStart, assignments });
  }
  addDeletedWeek(row, weekStart);
  clearLegacyFlags(state, row, weekStart);
};

// Remove a row from the active schedule while keeping deleted assignments in a
// separate history-only collection. A working-week deletion of a Master row
// affects that week only; the reusable Master row and other weeks are retained.
export function removeSchedulerRow(state, rowId, mode, workingDates) {
  if (!state || !Array.isArray(state.rows) || !Array.isArray(workingDates) || workingDates.length !== 7) {
    throw new TypeError("A schedule state and seven working dates are required");
  }
  if (mode !== "master" && mode !== "working") throw new TypeError("Mode must be master or working");

  const index = state.rows.findIndex((row) => String(row.id) === String(rowId));
  if (index < 0) return { removed: false, rowId };
  const row = state.rows[index];
  const weekStart = workingDates[0];

  if (row.scope === "working-week" && mode === "master") {
    throw new RangeError("A working-week row cannot be removed from the Master template");
  }
  if (row.scope === "working-week" && row.weekStart !== weekStart) {
    throw new RangeError("A working-week row can only be removed from its own week");
  }

  if (mode === "master" || row.scope === "working-week") {
    const archiveId = mode === "master" ? `master:${row.id}` : `working:${row.id}:${row.weekStart || weekStart}`;
    archiveRow(state, row, archiveId);
    state.rows.splice(index, 1);
    clearLegacyFlags(state, row);
    return { removed: true, rowId: row.id, mode, weekStart: mode === "working" ? row.weekStart || weekStart : undefined };
  }

  archiveWorkingWeek(state, row, weekStart, workingDates);
  return { removed: true, rowId: row.id, mode, weekStart };
};

export function rolloverMasterState(state, workingDates) {
  if (!state || !Array.isArray(state.rows) || !Array.isArray(workingDates) || workingDates.length !== 7) {
    throw new TypeError("A schedule state and seven working dates are required");
  }

  const weekStart = workingDates[0];
  let rowsUpdated = 0;
  let rowsHidden = 0;

  for (const row of [...state.rows]) {
    if (!row || row.scope === "history-only") continue;

    if (isMasterRowVisible(state, row)) {
      // A deliberate deletion in this week remains in force across repeated
      // rollovers. Other dates continue to follow the Master template.
      if (Array.isArray(row.deletedWeeks) && row.deletedWeeks.includes(weekStart)) continue;
      if (isWorkingRowDeleted(state, row, weekStart)) {
        archiveWorkingWeek(state, row, weekStart, workingDates);
        clearLegacyHiddenWeek(row, weekStart);
        rowsHidden += 1;
        continue;
      }

      row.assignments = row.assignments || {};
      row.master = row.master || {};

      if (row.scope === "master-only") {
        const rolloverWeeks = new Set(Array.isArray(row.rolloverWeeks) ? row.rolloverWeeks : []);
        rolloverWeeks.add(weekStart);
        row.rolloverWeeks = [...rolloverWeeks].sort();
      }

      for (let index = 0; index < workingDates.length; index += 1) {
        const source = row.master[DAYS[index]];
        row.assignments[workingDates[index]] = clone(source || blank());
      }
      rowsUpdated += 1;
      continue;
    }

    if (row.scope === "working-week" && row.weekStart === weekStart) {
      // Working-only rows are real rows for their own week, but never enter a
      // Master rollover or linger in its destination.
      const index = state.rows.indexOf(row);
      archiveRow(state, row, `working:${row.id}:${weekStart}`);
      state.rows.splice(index, 1);
      clearLegacyFlags(state, row);
      rowsHidden += 1;
      continue;
    }

    if (isWorkingRowVisible(state, row, weekStart)) {
      // This covers legacy Master deletions and rows without a reusable
      // Master template. Preserve the destination's old assignments outside
      // the active rows collection so they cannot reappear on another path.
      archiveWorkingWeek(state, row, weekStart, workingDates);
      rowsHidden += 1;
    }
  }

  state.lastRolloverWeek = weekStart;
  return { weekStart, rowsUpdated, rowsHidden };
}

if (typeof window !== "undefined") {
  window.THSchedulerRollover = Object.freeze({
    isMasterRowVisible,
    isWorkingRowDeleted,
    isWorkingRowVisible,
    removeSchedulerRow,
    rolloverMasterState
  });
}
