import assert from "node:assert/strict";
import test from "node:test";
import { historyEvents, summarizeSchedulerChanges } from "../functions/_shared/scheduler-history.js";

const state = (name = "", note = "OPEN") => ({
  staff: ["Alex Morgan"],
  rows: [{
    id: "city-lobby-a", site: "Cityscape", post: "Lobby", shiftCode: "A",
    assignments: { "2026-08-03": { status: name ? "assigned" : "open", name, start: "0600", end: "1400", note } },
    master: {}
  }]
});

test("history summary identifies the assignment fields that changed", () => {
  const result = summarizeSchedulerChanges(state(), state("Alex Morgan", "Supervisor approved coverage."));
  assert.equal(result.totalChanges, 1);
  assert.equal(result.changes[0].type, "assignment_updated");
  assert.equal(result.changes[0].before.status, "open");
  assert.equal(result.changes[0].after.officer, "Alex Morgan");
});

test("latest history event compares the restore point to current state", () => {
  const before = state();
  const current = state("Alex Morgan");
  const events = historyEvents(
    { state: current, revision: 2, updated_at: "2026-08-01T10:00:00.000Z" },
    [{ id: 17, revision: 1, state_json: JSON.stringify(before), created_at: "2026-08-01T09:59:00.000Z" }]
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].id, 17);
  assert.equal(events[0].singleRevision, true);
  assert.equal(events[0].changes[0].after.officer, "Alex Morgan");
});
