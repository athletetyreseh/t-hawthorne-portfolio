const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const blank = () => ({ status: "blank", name: "", start: "", end: "", note: "" });
const clone = (value) => JSON.parse(JSON.stringify(value));
const legacyRowKey = (row = {}) =>
  [row.site, row.shiftName, row.post, row.shiftCode, row.typeNum].join("|");

const hasLegacyFlag = (map, row) =>
  Boolean(map?.[row.id] || map?.[legacyRowKey(row)]);

export function isMasterRowVisible(state, row) {
  if (!row || row.masterHidden) return false;
  if (hasLegacyFlag(state?.hiddenRowsByScope?.master, row)) return false;
  return row.scope !== "working-week";
}

export function isWorkingRowVisible(state, row, weekStart) {
  if (!row) return false;
  const hiddenByWeek = state?.hiddenRowsByScope?.[weekStart];
  if (hasLegacyFlag(hiddenByWeek, row)) return false;
  if (Array.isArray(row.hiddenWeeks) && row.hiddenWeeks.includes(weekStart)) return false;

  if (row.scope === "working-week") return row.weekStart === weekStart;
  if (row.scope === "master-only") {
    return Array.isArray(row.rolloverWeeks) && row.rolloverWeeks.includes(weekStart);
  }
  return true;
}

const hideForWorkingWeek = (row, weekStart) => {
  const hiddenWeeks = new Set(Array.isArray(row.hiddenWeeks) ? row.hiddenWeeks : []);
  hiddenWeeks.add(weekStart);
  row.hiddenWeeks = [...hiddenWeeks].sort();
};

const clearLegacyWorkingHide = (state, row, weekStart) => {
  const hidden = state.hiddenRowsByScope?.[weekStart];
  if (!hidden) return;
  delete hidden[row.id];
  delete hidden[legacyRowKey(row)];
  if (!Object.keys(hidden).length) delete state.hiddenRowsByScope[weekStart];
};

export function rolloverMasterState(state, workingDates) {
  if (!state || !Array.isArray(state.rows) || !Array.isArray(workingDates) || workingDates.length !== 7) {
    throw new TypeError("A schedule state and seven working dates are required");
  }

  const weekStart = workingDates[0];
  let rowsUpdated = 0;
  let rowsHidden = 0;

  for (const row of state.rows) {
    if (isMasterRowVisible(state, row)) {
      row.assignments = row.assignments || {};
      row.master = row.master || {};

      if (row.scope === "master-only") {
        const rolloverWeeks = new Set(Array.isArray(row.rolloverWeeks) ? row.rolloverWeeks : []);
        rolloverWeeks.add(weekStart);
        row.rolloverWeeks = [...rolloverWeeks].sort();
      }

      if (Array.isArray(row.hiddenWeeks)) {
        row.hiddenWeeks = row.hiddenWeeks.filter((date) => date !== weekStart);
      }
      clearLegacyWorkingHide(state, row, weekStart);

      for (let index = 0; index < workingDates.length; index += 1) {
        const source = row.master[DAYS[index]];
        row.assignments[workingDates[index]] = clone(source || blank());
      }
      rowsUpdated += 1;
      continue;
    }

    // Keep assignments, including historical records, but hide rows that are
    // absent from Master in the destination working week.
    if (isWorkingRowVisible(state, row, weekStart)) {
      hideForWorkingWeek(row, weekStart);
      rowsHidden += 1;
    }
  }

  state.lastRolloverWeek = weekStart;
  return { weekStart, rowsUpdated, rowsHidden };
}

if (typeof window !== "undefined") {
  window.THSchedulerRollover = Object.freeze({
    isMasterRowVisible,
    isWorkingRowVisible,
    rolloverMasterState
  });
}
