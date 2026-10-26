import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/tools/th-operations-scheduler/api/officer-admin.js";

const owner = "scheduler@example.com";
const regularRows = [
  { id: "pto-pending", officer_name: "A. Officer", request_type: "pto", start_date: "2026-10-27", end_date: "2026-10-27", status: "pending", created_at: "2026-10-25T10:00:00.000Z" },
  { id: "late-pending", officer_name: "B. Officer", request_type: "late-in", start_date: "2026-10-28", end_date: "2026-10-28", status: "pending", created_at: "2026-10-25T11:00:00.000Z" },
  { id: "pto-approved", officer_name: "C. Officer", request_type: "pto", start_date: "2026-10-29", end_date: "2026-10-29", status: "approved", created_at: "2026-10-24T10:00:00.000Z" },
  { id: "late-approved", officer_name: "D. Officer", request_type: "late-out", start_date: "2026-10-30", end_date: "2026-10-30", status: "approved", created_at: "2026-10-24T09:00:00.000Z" },
  { id: "pto-denied", officer_name: "E. Officer", request_type: "pto", start_date: "2026-10-31", end_date: "2026-10-31", status: "denied", created_at: "2026-10-23T10:00:00.000Z" }
];
const overtimeRows = [
  { id: "overtime-pending", officer_name: "F. Officer", shift_date: "2026-11-01", row_id: "row-1", status: "pending", created_at: "2026-10-25T12:00:00.000Z" },
  { id: "overtime-approved", officer_name: "G. Officer", shift_date: "2026-11-02", row_id: "row-2", status: "approved", created_at: "2026-10-24T12:00:00.000Z" }
];

test("officer admin summary preserves badge counts and schedule markers without loading full panel data", async () => {
  const readQueries = [];
  const database = {
    prepare(sql) {
      let boundValues = [];
      return {
        bind(...values) { boundValues = values; return this; },
        async all() {
          readQueries.push(sql);
          assert.deepEqual(boundValues, [owner]);
          if (sql.includes("FROM officer_schedule_requests")) return { results: regularRows };
          if (sql.includes("FROM officer_schedule_overtime_requests")) return { results: overtimeRows };
          throw new Error("Unexpected query: " + sql);
        }
      };
    },
    async batch(statements) { return { results: statements.map(() => ({})) }; }
  };
  const response = await onRequestGet({
    request: new Request("https://example.com/tools/th-operations-scheduler/api/officer-admin?summary=1"),
    env: { SCHEDULER_DB: database },
    data: { schedulerUser: owner }
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.pendingCount, 3);
  assert.deepEqual(new Set(payload.requests.map((request) => request.id)), new Set([
    "pto-pending", "late-pending", "overtime-pending", "pto-approved"
  ]));
  assert.equal(payload.requests.find((request) => request.id === "overtime-pending").rowId, "row-1");
  assert.equal(payload.requests.some((request) => ["late-approved", "pto-denied", "overtime-approved"].includes(request.id)), false);
  assert.equal("schedule" in payload, false);
  assert.equal("officers" in payload, false);
  assert.equal("acknowledgements" in payload, false);
  assert.equal(readQueries.length, 2);
  assert.ok(readQueries.every((sql) => !/scheduler_state|staff_records|acknowledgements/.test(sql)));
});
