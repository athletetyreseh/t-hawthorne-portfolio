import assert from "node:assert/strict";
import test from "node:test";
import { SchedulerCommandError, executeSchedulerCommand } from "../functions/_shared/scheduler-commands.js";

const schedule = () => ({
  staff: ["Alex Morgan", "Jamie Lee"],
  removedStaff: [],
  rows: [
    {
      id: "city-lobby-a",
      site: "Cityscape",
      post: "Lobby",
      shiftCode: "A",
      shiftName: "First Shift",
      assignments: { "2026-08-03": { status: "open", name: "", start: "0600", end: "1400", note: "OPEN" } },
      master: { Mon: { status: "open", name: "", start: "0600", end: "1400", note: "OPEN" } }
    },
    {
      id: "city-lobby-b",
      site: "Cityscape",
      post: "Lobby",
      shiftCode: "B",
      shiftName: "Second Shift",
      assignments: { "2026-08-03": { status: "assigned", name: "Jamie Lee", start: "1400", end: "2200", note: "ASSIGNED" } },
      master: { Mon: { status: "assigned", name: "Jamie Lee", start: "1400", end: "2200", note: "ASSIGNED" } }
    }
  ]
});

const target = { site: "Cityscape", post: "Lobby", shift: "A", date: "2026-08-03" };

test("assign, change time, tag, and add a note without mutating source state", () => {
  const source = schedule();
  let next = executeSchedulerCommand(source, { kind: "assign", target, officer: "Alex Morgan" }).state;
  next = executeSchedulerCommand(next, { kind: "set_time", target, start: "06:30", end: "14:30" }).state;
  next = executeSchedulerCommand(next, { kind: "tag", target }).state;
  const executed = executeSchedulerCommand(next, { kind: "set_note", target, note: "Cover front entrance until lunch." });
  const assignment = executed.state.rows[0].assignments["2026-08-03"];
  assert.deepEqual(assignment, {
    status: "assigned", name: "Alex Morgan", start: "0630", end: "1430", note: "Cover front entrance until lunch.", tagged: true
  });
  assert.equal(source.rows[0].assignments["2026-08-03"].status, "open");
});

test("unassign preserves time and creates an open gap", () => {
  const state = schedule();
  const result = executeSchedulerCommand(state, { kind: "unassign", target: { ...target, shift: "B" } });
  assert.deepEqual(result.state.rows[1].assignments["2026-08-03"], {
    status: "open", name: "", start: "1400", end: "2200", note: "OPEN", tagged: true
  });
  assert.deepEqual(result.result.agentTags.tagged, [{ rowId: "city-lobby-b", site: "Cityscape", post: "Lobby", shift: "B", date: "2026-08-03", mode: "working" }]);
});

test("ambiguous targets and unknown officers are structured validation errors", () => {
  assert.throws(
    () => executeSchedulerCommand(schedule(), { kind: "set_note", target: { site: "Cityscape", post: "Lobby", date: "2026-08-03" }, note: "x" }),
    (error) => error instanceof SchedulerCommandError && error.code === "ambiguous_target" && error.status === 409
  );
  assert.throws(
    () => executeSchedulerCommand(schedule(), { kind: "assign", target, officer: "Unlisted Officer" }),
    (error) => error instanceof SchedulerCommandError && error.code === "officer_not_found"
  );
});

test("agent mutations auto-tag changed entries and rows without changing manual state", () => {
  const state = schedule();
  const timeResult = executeSchedulerCommand(state, { kind: "set_time", target, end: "1500" });
  assert.equal(timeResult.state.rows[0].assignments["2026-08-03"].tagged, true);
  assert.equal(timeResult.result.agentTags.total, 1);
  assert.equal(timeResult.result.agentTags.tagged[0].rowId, "city-lobby-a");

  const rowResult = executeSchedulerCommand(timeResult.state, { kind: "set_row_post", target, post: "Lobby Desk" });
  assert.equal(rowResult.state.rows[0].agentTagged, true);
  assert.equal(rowResult.result.agentTags.tagged[0].scope, "row");
  assert.equal(state.rows[0].agentTagged, undefined);
});

test("a batch is atomic, auto-tags entries, and can explicitly clean up tags", () => {
  const state = schedule();
  const result = executeSchedulerCommand(state, {
    kind: "batch",
    commands: [
      { kind: "assign", target: { ...target, mode: "master" }, officer: "Alex Morgan" },
      { kind: "untag", target: { ...target, mode: "master" } }
    ]
  });
  assert.equal(result.state.rows[0].master.Mon.name, "Alex Morgan");
  assert.equal(result.state.rows[0].master.Mon.tagged, false);
  assert.equal(result.result.commands.length, 2);
  assert.equal(result.result.agentTags.totalCleared, 1);
  assert.equal(result.result.agentTags.cleared[0].day, "Mon");
});

test("destructive commands require one explicit confirmation while exact routine edits do not", () => {
  assert.throws(
    () => executeSchedulerCommand(schedule(), { kind: "clear", target }),
    (error) => error instanceof SchedulerCommandError && error.code === "confirmation_required" && error.status === 409
  );
  const result = executeSchedulerCommand(schedule(), {
    kind: "batch",
    confirm: true,
    commands: [
      { kind: "clear", target },
      { kind: "block", target: { ...target, shift: "B" } }
    ]
  });
  assert.equal(result.state.rows[0].assignments["2026-08-03"].tagged, true);
  assert.equal(result.state.rows[1].assignments["2026-08-03"].tagged, true);
  assert.equal(result.result.agentTags.total, 2);
});
