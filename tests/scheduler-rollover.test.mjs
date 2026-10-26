import assert from "node:assert/strict";
import test from "node:test";
import {
  isMasterRowVisible,
  isWorkingRowVisible,
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
    hiddenWeeks: [weekStart, "2026-10-19"],
    master: { Mon: assigned("Master Monday"), Sat: assigned("Master Saturday"), Sun: assigned("Master Sunday") },
    assignments: { [weekStart]: assigned("Old target assignment"), "2026-10-19": assigned("Historical assignment") }
  };
  const hiddenMaster = {
    id: "hidden-master-row", site: "Cityscape", post: "Extra Coverage", shiftCode: "B", shiftName: "Second Shift", typeNum: 4,
    masterHidden: true,
    master: { Sat: assigned("Ty Tillman", "1800", "0600"), Sun: assigned("Ty Tillman", "1800", "0600") },
    assignments: { [weekStart]: assigned("Chad Magana"), "2026-10-19": assigned("Historical hidden-row assignment") }
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
    scope: "working-week", weekStart, master: { Mon: assigned("Must not copy") }, assignments: { [weekStart]: assigned("Keep working-week assignment") }
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
  return {
    staff: [],
    rows: [valid, hiddenMaster, legacyIdHidden, legacyBaseHidden, workingOnlyThisWeek, workingOnlyOtherWeek, insertedMaster],
    hiddenRowsByScope: {
      master: { [legacyIdHidden.id]: true, [baseKey(legacyBaseHidden)]: true },
      [weekStart]: { [valid.id]: true, [baseKey(valid)]: true }
    }
  };
}

test("rollover copies only visible Master rows and hides excluded rows for the destination week", () => {
  const state = schedule();
  const beforeRows = state.rows.length;
  const result = rolloverMasterState(state, dates);
  const [valid, hiddenMaster, legacyIdHidden, legacyBaseHidden, workingOnlyThisWeek, workingOnlyOtherWeek, insertedMaster] = state.rows;

  assert.deepEqual(result, { weekStart, rowsUpdated: 2, rowsHidden: 4 });
  assert.equal(state.rows.length, beforeRows);
  assert.equal(valid.assignments[weekStart].name, "Master Monday");
  assert.equal(valid.assignments["2026-10-19"].name, "Historical assignment");
  assert.deepEqual(valid.hiddenWeeks, ["2026-10-19"]);
  assert.equal(isWorkingRowVisible(state, valid, weekStart), true);
  assert.equal(state.hiddenRowsByScope[weekStart], undefined);

  assert.equal(isMasterRowVisible(state, hiddenMaster), false);
  assert.equal(hiddenMaster.assignments[weekStart].name, "Chad Magana");
  assert.equal(hiddenMaster.assignments["2026-10-19"].name, "Historical hidden-row assignment");
  assert.equal(hiddenMaster.hiddenWeeks.includes(weekStart), true);
  assert.equal(isWorkingRowVisible(state, hiddenMaster, weekStart), false);

  assert.equal(isMasterRowVisible(state, legacyIdHidden), false);
  assert.equal(legacyIdHidden.assignments[weekStart].name, "Keep legacy ID assignment");
  assert.equal(legacyIdHidden.hiddenWeeks.includes(weekStart), true);
  assert.equal(isMasterRowVisible(state, legacyBaseHidden), false);
  assert.equal(legacyBaseHidden.assignments[weekStart].name, "Keep legacy base assignment");
  assert.equal(legacyBaseHidden.hiddenWeeks.includes(weekStart), true);

  assert.equal(isMasterRowVisible(state, workingOnlyThisWeek), false);
  assert.equal(workingOnlyThisWeek.assignments[weekStart].name, "Keep working-week assignment");
  assert.equal(workingOnlyThisWeek.hiddenWeeks.includes(weekStart), true);
  assert.equal(workingOnlyOtherWeek.assignments["2026-10-19"].name, "Past assignment");
  assert.equal(workingOnlyOtherWeek.assignments[weekStart].name, "Out-of-scope data");
  assert.deepEqual(workingOnlyOtherWeek.hiddenWeeks, undefined);

  assert.equal(insertedMaster.assignments[weekStart].name, "Inserted Master officer");
  assert.equal(insertedMaster.scope, "master-only");
  assert.deepEqual(insertedMaster.rolloverWeeks, ["2026-10-19", weekStart]);
  assert.equal(isWorkingRowVisible(state, insertedMaster, weekStart), true);
  assert.equal(state.lastRolloverWeek, weekStart);
});

test("repeating rollover does not duplicate rows or row visibility entries", () => {
  const state = schedule();
  rolloverMasterState(state, dates);
  const rowCount = state.rows.length;
  const inserted = state.rows.find((row) => row.id === "inserted-master-row");
  rolloverMasterState(state, dates);
  assert.equal(state.rows.length, rowCount);
  assert.deepEqual(inserted.rolloverWeeks, ["2026-10-19", weekStart]);
  assert.equal(new Set(state.rows.find((row) => row.id === "hidden-master-row").hiddenWeeks).size, 1);
});

test("server rollover uses the same visibility-aware behavior", () => {
  const state = schedule();
  const result = executeSchedulerCommand(state, { kind: "rollover_master", date: weekStart, confirm: true });
  assert.equal(result.result.rowsUpdated, 2);
  assert.equal(result.result.rowsHidden, 4);
  assert.equal(result.state.rows.find((row) => row.id === "hidden-master-row").assignments[weekStart].name, "Chad Magana");
  assert.equal(result.state.rows.find((row) => row.id === "inserted-master-row").assignments[weekStart].name, "Inserted Master officer");
  assert.equal(result.state.lastRolloverWeek, weekStart);
});

test("server rollover still requires confirmation", () => {
  assert.throws(
    () => executeSchedulerCommand(schedule(), { kind: "rollover_master", date: weekStart }),
    (error) => error instanceof SchedulerCommandError && error.code === "confirmation_required"
  );
});
