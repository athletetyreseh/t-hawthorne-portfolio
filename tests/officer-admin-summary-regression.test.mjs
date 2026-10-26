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

test("officer admin details load only the selected week's signatures and avoid parsing the schedule", async () => {
  const readQueries = [];
  const regularRow = {
    id: "pto-pending", officer_name: "A. Officer", officer_email: "a@example.com", request_type: "pto",
    start_date: "2026-10-27", end_date: "2026-10-27", requested_time: "", message: "Family appointment",
    status: "pending", denial_message: "", created_at: "2026-10-25T10:00:00.000Z", resolved_at: null, resolved_by: ""
  };
  const overtimeRow = {
    id: "overtime-approved", row_id: "row-1", shift_date: "2026-10-28", site: "North", post: "Gate",
    shift_name: "Evening", start_time: "16:00", end_time: "00:00", officer_name: "B. Officer",
    officer_email: "b@example.com", message: "Can cover", status: "approved", denial_message: "",
    created_at: "2026-10-24T12:00:00.000Z", resolved_at: "2026-10-24T13:00:00.000Z", resolved_by: "scheduler@example.com"
  };
  const acknowledgementRow = {
    id: "ack-this-week", officer_name: "A. Officer", officer_email: "a@example.com",
    week_start: "2026-10-26", signature_data: "data:image/png;base64,signature", signed_at: "2026-10-26T09:00:00.000Z"
  };
  const database = {
    prepare(sql) {
      let boundValues = [];
      return {
        bind(...values) { boundValues = values; return this; },
        async all() {
          readQueries.push({ sql, boundValues });
          if (sql.includes("FROM officer_schedule_requests")) return { results: [regularRow] };
          if (sql.includes("FROM officer_schedule_overtime_requests")) return { results: [overtimeRow] };
          if (sql.includes("FROM officer_schedule_acknowledgements")) return { results: [acknowledgementRow] };
          if (sql.includes("FROM staff_records")) return { results: [{ full_name: "A. Officer", email: "a@example.com" }] };
          throw new Error("Unexpected query: " + sql);
        }
      };
    },
    async batch(statements) { return { results: statements.map(() => ({})) }; }
  };
  const response = await onRequestGet({
    request: new Request("https://example.com/tools/th-operations-scheduler/api/officer-admin?weekStart=2026-10-26"),
    env: { SCHEDULER_DB: database },
    data: { schedulerUser: owner }
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.schedule, null);
  assert.deepEqual(payload.officers, [
    { name: "A. Officer", email: "a@example.com" },
    { name: "B. Officer", email: "b@example.com" }
  ]);
  assert.equal(payload.requests.length, 2);
  assert.equal(payload.requests.find((request) => request.id === "pto-pending").message, "Family appointment");
  assert.equal(payload.requests.find((request) => request.id === "overtime-approved").site, "North");
  assert.deepEqual(payload.acknowledgements, [{
    id: "ack-this-week", officerName: "A. Officer", officerEmail: "a@example.com", weekStart: "2026-10-26",
    signedAt: "2026-10-26T09:00:00.000Z", signatureData: "data:image/png;base64,signature"
  }]);
  assert.equal(readQueries.length, 3);
  assert.ok(readQueries.every(({ sql }) => !/scheduler_state/.test(sql)));
  const regularRequestsQuery = readQueries.find(({ sql }) => sql.includes("FROM officer_schedule_requests AS request"));
  const overtimeRequestsQuery = readQueries.find(({ sql }) => sql.includes("FROM officer_schedule_overtime_requests AS overtime"));
  assert.match(regularRequestsQuery.sql, /SELECT staff.email FROM staff_records AS staff/);
  assert.match(overtimeRequestsQuery.sql, /SELECT staff.email FROM staff_records AS staff/);
  assert.deepEqual(new Set(payload.officers.map((officer) => officer.name)), new Set(["A. Officer", "B. Officer"]));
  assert.ok(payload.officers.every((officer) => officer.email));
  const acknowledgementsQuery = readQueries.find(({ sql }) => sql.includes("FROM officer_schedule_acknowledgements"));
  assert.match(acknowledgementsQuery.sql, /week_start = \?/);
  assert.deepEqual(acknowledgementsQuery.boundValues, [owner, "2026-10-26"]);
});
