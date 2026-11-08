import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequestGet } from "../functions/officer-schedule/api.js";

function databaseFixture() {
  const calls = [];
  const data = {
    revision: 12,
    updatedAt: "2026-11-08T10:00:00.000Z",
    requestCount: 2,
    requestUpdatedAt: "2026-11-08T10:01:00.000Z",
    overtimeCount: 1,
    overtimeUpdatedAt: "2026-11-08T10:02:00.000Z",
    acknowledgementCount: 4,
    acknowledgementsUpdatedAt: "2026-11-08T10:03:00.000Z"
  };
  const database = {
    async batch() { return []; },
    prepare(sql) {
      calls.push(sql);
      let args = [];
      const statement = {
        bind(...values) { args = values; return statement; },
        async first() {
          if (sql.includes("SELECT revision, updated_at FROM scheduler_state")) {
            return { revision: data.revision, updated_at: data.updatedAt };
          }
          if (sql.includes("FROM officer_schedule_requests") && sql.includes("COUNT(*)")) {
            return { count: data.requestCount, updated_at: data.requestUpdatedAt };
          }
          if (sql.includes("FROM officer_schedule_overtime_requests") && sql.includes("COUNT(*)")) {
            return { count: data.overtimeCount, updated_at: data.overtimeUpdatedAt };
          }
          if (sql.includes("FROM officer_schedule_acknowledgements") && sql.includes("COUNT(*)")) {
            return { count: data.acknowledgementCount, updated_at: data.acknowledgementsUpdatedAt };
          }
          if (sql.includes("SELECT owner_email, state_json, revision, updated_at FROM scheduler_state")) {
            return { owner_email: "owner@example.com", state_json: JSON.stringify({ rows: [], staff: [], dates: [] }), revision: data.revision, updated_at: data.updatedAt };
          }
          return null;
        },
        async all() { return { results: [] }; },
        async run() { return { meta: { changes: 0 } }; }
      };
      return statement;
    }
  };
  const context = (summary) => ({
    env: { SCHEDULER_DB: database, OWNER_EMAIL: "owner@example.com" },
    data: { schedulerUser: "owner@example.com" },
    request: new Request(`https://t-hawthorne.com/officer-schedule/api${summary ? "?summary=1" : ""}`)
  });
  return { calls, data, database, context };
}

test("public change summary reads metadata only and tracks schedule, request, overtime, and signature changes", async () => {
  const fixture = databaseFixture();
  const summary = await (await onRequestGet(fixture.context(true))).json();
  assert.equal(summary.revision, 12);
  assert.equal(summary.requestCount, 2);
  assert.equal(summary.overtimeCount, 1);
  assert.equal(summary.acknowledgementCount, 4);
  assert.equal(summary.changeToken, "12|2026-11-08T10:00:00.000Z|2|2026-11-08T10:01:00.000Z|1|2026-11-08T10:02:00.000Z|4|2026-11-08T10:03:00.000Z");
  assert.equal(fixture.calls.some((sql) => sql.includes("state_json")), false);

  const before = summary.changeToken;
  fixture.data.requestCount += 1;
  fixture.data.requestUpdatedAt = "2026-11-08T10:04:00.000Z";
  const after = await (await onRequestGet(fixture.context(true))).json();
  assert.notEqual(after.changeToken, before);
});

test("full public schedule and lightweight summary use the same change token", async () => {
  const fixture = databaseFixture();
  const summary = await (await onRequestGet(fixture.context(true))).json();
  const full = await (await onRequestGet(fixture.context(false))).json();
  assert.equal(full.changeToken, summary.changeToken);
  assert.equal(full.schedule.rows.length, 0);
});

test("public officer page polls a lightweight token every ten seconds", async () => {
  const source = await readFile(new URL("../portfolio-site/tools/th-operations-scheduler/officers/officer-schedule.js", import.meta.url), "utf8");
  assert.match(source, /const POLL_MS = 10_000/);
  assert.match(source, /const SUMMARY_API = `\$\{API\}\?summary=1`/);
  assert.match(source, /summary\.changeToken !== changeToken/);
  assert.match(source, /window\.setInterval\(\(\) => checkForUpdates\(false\), POLL_MS\)/);
  assert.doesNotMatch(source, /window\.setInterval\(\(\) => loadSchedule/);
});

