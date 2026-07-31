import {
  errorResponse,
  json,
  parseBody,
  requireSameOrigin,
  restoreSchedulerState,
  stateResponse
} from "../../../_shared/scheduler.js";

export async function onRequestPost(context) {
  try {
    if (!requireSameOrigin(context.request)) return json({ error: "Invalid request origin" }, 403);
    const ownerEmail = context.data.schedulerUser;
    const body = await parseBody(context.request);
    const versionId = Number(body.versionId);
    if (!Number.isInteger(versionId) || versionId <= 0) return json({ error: "A valid restore point is required" }, 400);

    const restored = await restoreSchedulerState(context.env.SCHEDULER_DB, ownerEmail, versionId);
    if (restored.notFound) return json({ error: "Restore point was not found" }, 404);
    if (restored.noCurrent) return json({ error: "Current cloud schedule was not found" }, 404);
    if (restored.conflict) return json({ error: "Cloud schedule changed while restoring", revision: restored.revision, updatedAt: restored.updatedAt }, 409);
    return stateResponse(restored);
  } catch (error) {
    return errorResponse(error);
  }
}
