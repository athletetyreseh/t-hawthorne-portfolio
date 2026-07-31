import assert from "node:assert/strict";
import test from "node:test";
import { getSchedulerCapabilityManifest } from "../functions/_shared/scheduler-capabilities.js";
import { onRequestGet } from "../functions/tools/th-operations-scheduler/api/capabilities.js";

test("capability manifest advertises the private command surface without schedule data", () => {
  const manifest = getSchedulerCapabilityManifest();
  assert.equal(manifest.product, "TH Operations Scheduler");
  assert.equal(manifest.privacy.scheduleDataIncluded, false);
  assert.equal(manifest.endpoints.manifest.path, "/tools/th-operations-scheduler/api/capabilities");
  assert.ok(manifest.operations.assignments.includes("assign"));
  assert.ok(manifest.operations.rows.includes("insert_row"));
  assert.ok(manifest.operations.statuses.allowed.includes("pto"));
  assert.ok(manifest.safety.confirmations.some((item) => item.includes("undo")));
  assert.match(manifest.agentExecutionRules.codeFirst, /batch command/);
  assert.match(manifest.agentExecutionRules.automaticTags, /automatically/i);
  assert.match(manifest.agentExecutionRules.confirmation, /no confirmation/i);
  assert.match(manifest.operations.tagCleanup.behavior, /untag/);
  assert.equal(JSON.stringify(manifest).includes("state_json"), false);
});

test("capability endpoint returns the manifest as private-state-free JSON", async () => {
  const response = await onRequestGet();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(body.privacy.scheduleDataIncluded, false);
  assert.equal(body.endpoints.commands.method, "POST");
});
