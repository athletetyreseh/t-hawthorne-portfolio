import assert from "node:assert/strict";
import test from "node:test";
import {
  isMasterRowVisible,
  isWorkingRowVisible,
  removeSchedulerRow,
  rolloverMasterState
} from "../portfolio-site/tools/th-operations-scheduler/rollover.js";
import { SchedulerCommandError, executeSchedulerCommand } from "../functions/_shared/scheduler-commands.js";

const weekStart = "2026-10-26";
const dates = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];
const assigned = (name, start = "1400", end = "2200") => ({ status: "assigned", name, start, end, note: "" });
const baseKey = (row) => [row.site, row.shiftName, row.post, row.shiftCode, row.typeNum].join("|");

function schedule() {
  const valid = {
    id: "valid-master-row", site: "Cityscape", post: "Lobby", shiftCode: "A", shiftName: "First Shift", typeNum: 1,
    hiddenWeeks: ["2026-10-19"],
    master: { Mon: assigned("Master Monday"), Sat: assigned("Master Saturday"), Sun: assigned("Master Sunday") },
    assignments: { [weekStart]: assigned("Old target assignment"), "2026-10-19": assigned("Historical assignment") }
  };
  const hiddenMaster = {
    id: "hidden-master-row", site: "Cityscape", post: "Extra Coverage", shiftCode: "B", shiftName: "Second Shift", typeNum: 4,
    masterHidden: true,
    master: { Sat: assigned("Ty Tillman", "1800", "0600"), Sun: assigned("Ty Tillman", "1800", "0600") },
    assignments: { [weekStart]: assigned("Customized target assignment"), "2026-10-19": assigned("Historical hidden-row assignment") }
  };
  const legacyIdHidden = {
    id: "legacy-id-hidden", site: "Cityscape", post: "Extra Coverage", shiftCode: "B", shiftName: "Second Shift", typeNum: 5,
    master: { Sat: assigned("Legacy ID officer") }, assignments: { [weekStart]: assigned("Keep legacy ID assignment") }
  };
  const legacyBaseHidden = {
    id: "legacy-base-hidden", site: "Cityscape", post: "Security Officer", shiftCode: "B", shiftName: "Second Shift", typeNum: 6,
    master: { Sat: assigned("Legacy base officer") }, assignments: { [weekStart]: assigned("Keep legacy base assignment") }
  };
  const workingOnlyThisWeek = {
    id: "working-only-current", site: "Cityscape", post: "Extra Coverage", shiftCode: "B", shiftName: "Second Shift", typeNum: 7,
    scope: "working-week", weekStart, master: { Mon: assigned("Must not copy") }, assignments: { [weekStart]: assigned("Current working-only assignment") }
  };
  const workingOnlyOtherWeek = {
    id: "working-only-past", site: "Cityscape", post: "Extra Coverage", shiftCode: "B", shiftName: "Second Shift", typeNum: 8,
    scope: "working-week", weekStart: "2026-10-19", master: { Mon: assigned("Must not copy either") },
    assignments: { "2026-10-19": assigned("Past assignment"), [weekStart]: assigned("Out-of-scope data") }
  };
  const insertedMaster = {
    id: "inserted-master-row", site: "Cityscape", post: "Extra Coverage", shiftCode: "B", shiftName: "Second Shift", typeNum: 9,
    scope: "master-only", rolloverWeeks: ["2026-10-19"], master: { Mon: assigned("Inserted Master officer") },
    assignments: { "2026-10-19": assigned("Earlier rolled assignment") }
  };
  const historyOnly = {
    id: "history-only-row", site: "Cityscape", post: "Archive", shiftCode: "C", shiftName: "Third Shift", typeNum: 10,
    scope: "history-only", master: { Mon: assigned("Must stay archival") }, assignments: { [weekStart]: assigned("Archived assignment") }
  };
  return {
    staff: [],
    rows: [valid, hiddenMaster, legacyIdHidden, legacyBaseHidden, workingOnlyThisWeek, workingOnlyOtherWeek, insertedMaster, historyOnly],
    hiddenRowsByScope: {
      master: { [legacyIdHidden.id]: true, [baseKey(legacyBaseHidden)]: true }
    }
  };
}

test("rollover copies visible Master rows and archives deleted or working-only destination rows", () => {
  const state = schedule();
  const result = rolloverMasterState(state, dates);
  const row = (id) => state.rows.find((item) => item.id === id);
  const valid = row("valid-master-row");

  assert.deepEqual(result, { weekStart, rowsUpdated: 2, rowsHidden: 4 });
  assert.equal(valid.assignments[weekStart].name, "Master Monday");
  assert.equal(valid.assignments["2026-10-19"].name, "Historical assignment");
  assert.deepEqual(valid.hiddenWeeks, ["2026-10-19"]);
  assert.equal(isWorkingRowVisible(state, valid, weekStart), true);

  for (const id of ["hidden-master-row", "legacy-id-hidden", "legacy-base-hidden"]) {
    const hidden = row(id);
    assert.equal(hidden.assignments[weekStart], undefined);
    assert.equal(hidden.deletedWeeks.includes(weekStart), true);
    assert.equal(isWorkingRowVisible(state, hidden, weekStart), false);
  }
  assert.equal(state.historyRows.find((item) => item.archiveId === `working:hidden-master-row:${weekStart}`).assignments[weekStart].name, "Customized target assignment");
  assert.equal(state.historyRows.find((item) => item.archiveId === `working:hidden-master-row:${weekStart}`).assignments["2026-10-19"], undefined);
  assert.equal(isMasterRowVisible(state, row("hidden-master-row")), false);
  assert.deepEqual(state.hiddenRowsByScope.master, {
    "legacy-id-hidden": true,
    [baseKey(row("legacy-base-hidden"))]: true
  });

  assert.equal(row("working-only-current"), undefined);
  assert.equal(state.historyRows.find((item) => item.archiveId === `working:working-only-current:${weekStart}`).assignments[weekStart].name, "Current working-only assignment");
  assert.equal(row("working-only-past").assignments["2026-10-19"].name, "Past assignment");
  assert.equal(row("working-only-past").assignments[weekStart].name, "Out-of-scope data");

  const inserted = row("inserted-master-row");
  assert.equal(inserted.assignments[weekStart].name, "Inserted Master officer");
  assert.deepEqual(inserted.rolloverWeeks, ["2026-10-19", weekStart]);
  const historyOnly = row("history-only-row");
  assert.equal(isMasterRowVisible(state, historyOnly), false);
  assert.equal(isWorkingRowVisible(state, historyOnly, weekStart), false);
  assert.equal(historyOnly.assignments[weekStart].name, "Archived assignment");
});

test("repeating rollover is idempotent and does not restore deliberately deleted rows", () => {
  const state = schedule();
  rolloverMasterState(state, dates);
  const before = structuredClone(state);
  const result = rolloverMasterState(state, dates);

  assert.deepEqual(result, { weekStart, rowsUpdated: 2, rowsHidden: 0 });
  assert.deepEqual(state.historyRows, before.historyRows);
  assert.equal(state.rows.filter((row) => row.id === "inserted-master-row").length, 1);
  assert.equal(state.rows.find((row) => row.id === "hidden-master-row").assignments[weekStart], undefined);
});

test("rollover archives legacy per-week hidden assignments and converts their marker", () => {
  const state = {
    staff: [],
    rows: [{
      id: "legacy-week-hidden", site: "Cityscape", post: "Extra Coverage", shiftCode: "B", shiftName: "Second Shift", typeNum: 11,
      hiddenWeeks: [weekStart, "2026-10-19"],
      master: { Sat: assigned("Master Saturday") },
      assignments: { [weekStart]: assigned("Legacy hidden assignment"), "2026-10-19": assigned("Other week assignment") }
    }],
    hiddenRowsByScope: { [weekStart]: { "legacy-week-hidden": true } }
  };

  const result = rolloverMasterState(state, dates);
  const row = state.rows[0];
  const archive = state.historyRows.find((item) => item.archiveId === `working:${row.id}:${weekStart}`);

  assert.equal(result.rowsHidden, 1);
  assert.equal(row.assignments[weekStart], undefined);
  assert.equal(row.assignments["2026-10-19"].name, "Other week assignment");
  assert.deepEqual(row.hiddenWeeks, ["2026-10-19"]);
  assert.deepEqual(row.deletedWeeks, [weekStart]);
  assert.equal(archive.assignments[weekStart].name, "Legacy hidden assignment");
  assert.equal(state.hiddenRowsByScope?.[weekStart], undefined);
});

test("working deletion removes that week's active assignments and preserves the template and other weeks", () => {
  const state = schedule();
  const row = state.rows[0];
  const deletion = removeSchedulerRow(state, row.id, "working", dates);

  assert.deepEqual(deletion, { removed: true, rowId: row.id, mode: "working", weekStart });
  assert.equal(state.rows[0].master.Mon.name, "Master Monday");
  assert.equal(state.rows[0].assignments[weekStart], undefined);
  assert.equal(state.rows[0].assignments["2026-10-19"].name, "Historical assignment");
  assert.equal(state.historyRows.find((item) => item.archiveId === `working:${row.id}:${weekStart}`).assignments[weekStart].name, "Old target assignment");
  assert.equal(isWorkingRowVisible(state, row, weekStart), false);

  rolloverMasterState(state, dates);
  assert.equal(row.assignments[weekStart], undefined);
  assert.equal(row.assignments["2026-10-19"].name, "Historical assignment");
});

test("Master and working-only row deletion removes active records and keeps history-only records out of rollover", () => {
  const state = schedule();
  const masterRow = state.rows.find((row) => row.id === "valid-master-row");
  const removedMaster = removeSchedulerRow(state, masterRow.id, "master", dates);
  assert.equal(state.rows.some((row) => row.id === masterRow.id), false);
  assert.equal(removedMaster.mode, "master");
  const masterArchive = state.historyRows.find((row) => row.archiveId === `master:${masterRow.id}`);
  assert.equal(masterArchive.scope, "history-only");
  assert.equal(isMasterRowVisible(state, masterArchive), false);
  assert.equal(isWorkingRowVisible(state, masterArchive, weekStart), false);
  const archivalAssignments = structuredClone(masterArchive.assignments);

  const workingRow = state.rows.find((row) => row.id === "working-only-past");
  const pastDates = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];
  removeSchedulerRow(state, workingRow.id, "working", pastDates);
  assert.equal(state.rows.some((row) => row.id === workingRow.id), false);

  rolloverMasterState(state, dates);
  assert.equal(state.historyRows.find((row) => row.archiveId === `master:${masterRow.id}`).assignments[weekStart].name, archivalAssignments[weekStart].name);
  assert.equal(state.rows.some((row) => row.id === "working-only-past"), false);
});

test("server rollover uses the shared visibility and archival behavior", () => {
  const result = executeSchedulerCommand(schedule(), { kind: "rollover_master", date: weekStart, confirm: true });
  const hiddenMaster = result.state.rows.find((row) => row.id === "hidden-master-row");
  assert.equal(hiddenMaster.assignments[weekStart], undefined);
  assert.equal(result.state.historyRows.find((row) => row.archiveId === `working:hidden-master-row:${weekStart}`).assignments[weekStart].name, "Customized target assignment");
  assert.equal(result.result.rowsHidden, 4);
});

test("server row deletion requires confirmation and removes active Master rows", () => {
  const state = schedule();
  assert.throws(
    () => executeSchedulerCommand(state, { kind: "remove_row", target: { rowId: "valid-master-row", date: weekStart, mode: "master" } }),
    (error) => error instanceof SchedulerCommandError && error.code === "confirmation_required"
  );
  const result = executeSchedulerCommand(state, { kind: "remove_row", target: { rowId: "valid-master-row", date: weekStart, mode: "master" }, confirm: true });
  assert.equal(result.state.rows.some((row) => row.id === "valid-master-row"), false);
  assert.equal(result.state.historyRows.some((row) => row.archiveId === "master:valid-master-row"), true);
});

test("working-week row deletion is limited to its own week and mode", () => {
  const state = schedule();
  assert.throws(
    () => removeSchedulerRow(state, "working-only-past", "working", dates),
    /only be removed from its own week/
  );
  assert.throws(
    () => removeSchedulerRow(state, "working-only-past", "master", dates),
    /cannot be removed from the Master template/
  );
  assert.throws(
    () => executeSchedulerCommand(state, { kind: "remove_row", target: { rowId: "working-only-past", date: weekStart }, confirm: true }),
    (error) => error instanceof SchedulerCommandError && error.code === "target_not_found"
  );
  assert.equal(state.rows.some((row) => row.id === "working-only-past"), true);
});
