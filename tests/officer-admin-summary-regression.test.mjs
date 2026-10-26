import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
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
  let acknowledgementSummary = { acknowledgement_count: 0, latest_signed_at: null };
  const database = {
    prepare(sql) {
      let boundValues = [];
      return {
        bind(...values) { boundValues = values; return this; },
        async all() {
          readQueries.push({ sql, boundValues });
          if (sql.includes("FROM officer_schedule_requests")) {
            assert.deepEqual(boundValues, [owner]);
            return { results: regularRows };
          }
          if (sql.includes("FROM officer_schedule_overtime_requests")) {
            assert.deepEqual(boundValues, [owner]);
            return { results: overtimeRows };
          }
          if (sql.includes("FROM officer_schedule_acknowledgements")) {
            assert.deepEqual(boundValues, [owner, "2026-10-26"]);
            return { results: [acknowledgementSummary] };
          }
          throw new Error("Unexpected query: " + sql);
        }
      };
    },
    async batch(statements) { return { results: statements.map(() => ({})) }; }
  };
  const summaryRequest = () => onRequestGet({
    request: new Request("https://example.com/tools/th-operations-scheduler/api/officer-admin?summary=1&weekStart=2026-10-26"),
    env: { SCHEDULER_DB: database },
    data: { schedulerUser: owner }
  });
  const response = await summaryRequest();

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
  assert.match(payload.panelToken, /^[a-z0-9]+$/);
  assert.equal(readQueries.length, 3);
  assert.ok(readQueries.every(({ sql }) => !/scheduler_state|staff_records|signature_data/.test(sql)));
  const acknowledgementsQuery = readQueries.find(({ sql }) => sql.includes("FROM officer_schedule_acknowledgements"));
  assert.match(acknowledgementsQuery.sql, /COUNT\(\*\)/);
  assert.deepEqual(acknowledgementsQuery.boundValues, [owner, "2026-10-26"]);

  regularRows[0].status = "approved";
  regularRows[0].resolved_at = "2026-10-26T12:00:00.000Z";
  const statusChanged = await (await summaryRequest()).json();
  assert.notEqual(statusChanged.panelToken, payload.panelToken);
  acknowledgementSummary = { acknowledgement_count: 1, latest_signed_at: "2026-10-26T12:05:00.000Z" };
  const signatureChanged = await (await summaryRequest()).json();
  assert.notEqual(signatureChanged.panelToken, statusChanged.panelToken);
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
          if (sql.includes("FROM officer_schedule_acknowledgements") && sql.includes("COUNT(*)")) return { results: [{ acknowledgement_count: 1, latest_signed_at: acknowledgementRow.signed_at }] };
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
  assert.match(payload.panelToken, /^[a-z0-9]+$/);
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
  const summaryResponse = await onRequestGet({
    request: new Request("https://example.com/tools/th-operations-scheduler/api/officer-admin?summary=1&weekStart=2026-10-26"),
    env: { SCHEDULER_DB: database },
    data: { schedulerUser: owner }
  });
  const summaryPayload = await summaryResponse.json();
  assert.equal(summaryPayload.panelToken, payload.panelToken);
  const acknowledgementsQuery = readQueries.find(({ sql }) => sql.includes("FROM officer_schedule_acknowledgements"));
  assert.match(acknowledgementsQuery.sql, /week_start = \?/);
  assert.deepEqual(acknowledgementsQuery.boundValues, [owner, "2026-10-26"]);
});


test("officer panel polls summaries and reloads details only after data or week changes", async () => {
  const source = await readFile(new URL("../portfolio-site/tools/th-operations-scheduler/officer-requests.js", import.meta.url), "utf8");
  const calls = [];
  const elements = new Map();
  let summaryToken = "version-1";
  let intervalCallback;
  const element = (id) => {
    if (!elements.has(id)) {
      const listeners = {};
      elements.set(id, {
        id,
        listeners,
        value: id === "rangeStart" ? "2026-10-26" : "",
        textContent: "",
        innerHTML: "",
        classList: { toggle() {} },
        addEventListener(name, callback) { listeners[name] = callback; },
        querySelectorAll() { return []; },
        select() {}
      });
    }
    return elements.get(id);
  };
  const document = {
    visibilityState: "visible",
    body: { insertAdjacentHTML() {} },
    getElementById(id) { return id === "scheduleTable" ? null : element(id); },
    addEventListener() {}
  };
  const window = {
    setInterval(callback, delay) { assert.equal(delay, 10000); intervalCallback = callback; },
    addEventListener() {}
  };
  const location = { href: "https://example.com/tools/th-operations-scheduler/", origin: "https://example.com" };
  const fetch = async (input) => {
    const url = new URL(String(input), location.href);
    calls.push(url);
    const payload = url.searchParams.get("summary") === "1"
      ? { requests: [], pendingCount: 0, panelToken: summaryToken }
      : { requests: [], acknowledgements: [], officers: [], panelToken: summaryToken };
    return { ok: true, json: async () => payload };
  };
  const context = { document, window, location, URL, fetch, console, state: {}, render() {} };
  runInNewContext(source, context);
  const settle = async () => {
    for (let index = 0; index < 5; index++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const summaryCalls = () => calls.filter((url) => url.searchParams.get("summary") === "1");
  const detailCalls = () => calls.filter((url) => url.searchParams.get("summary") !== "1");

  await settle();
  assert.equal(summaryCalls().length, 1);
  assert.equal(detailCalls().length, 0);
  document.visibilityState = "hidden";
  intervalCallback();
  await settle();
  assert.equal(summaryCalls().length, 1);

  document.visibilityState = "visible";
  element("officerAdminButton").listeners.click();
  await settle();
  assert.equal(detailCalls().length, 1);
  assert.equal(detailCalls()[0].searchParams.get("weekStart"), "2026-10-26");

  intervalCallback();
  await settle();
  assert.equal(summaryCalls().length, 2);
  assert.equal(detailCalls().length, 1);

  summaryToken = "version-2";
  intervalCallback();
  await settle();
  assert.equal(detailCalls().length, 2);

  element("rangeStart").value = "2026-11-02";
  context.render();
  await settle();
  assert.equal(detailCalls().length, 3);
  assert.equal(detailCalls()[2].searchParams.get("weekStart"), "2026-11-02");
});
