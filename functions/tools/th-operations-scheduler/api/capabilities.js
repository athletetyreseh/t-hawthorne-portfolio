import { json } from "../../../_shared/scheduler.js";
import { getSchedulerCapabilityManifest } from "../../../_shared/scheduler-capabilities.js";

// This stays behind the scheduler's existing permission middleware, but is
// deliberately state-free so a newly connected trusted agent can discover the
// command contract without loading private schedule content.
export async function onRequestGet() {
  return json(getSchedulerCapabilityManifest());
}
