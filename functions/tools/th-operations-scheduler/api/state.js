import {
  errorResponse,
  json,
  parseBody,
  requireSameOrigin,
  saveSchedulerState,
  stateResponse
} from "../../../_shared/scheduler.js";

export async function onRequestGet(context) {
  try {
    const ownerEmail = context.data.schedulerUser;
    const row = await context.env.SCHEDULER_DB.prepare(
      "SELECT state_json, revision, updated_at FROM scheduler_state WHERE owner_email = ?"
    ).bind(ownerEmail).first();
    return stateResponse(row);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPut(context) {
  try {
    if (!requireSameOrigin(context.request)) return json({ error: "Invalid request origin" }, 403);
    const ownerEmail = context.data.schedulerUser;
    const body = await parseBody(context.request);
    const force = body.force === true;
    const baseRevision = body.baseRevision == null ? null : Number(body.baseRevision);
    const saved = await saveSchedulerState(context.env.SCHEDULER_DB, ownerEmail, body.state, { baseRevision, force });
    if (saved.conflict) return json({ error: "Cloud schedule changed", revision: saved.revision, updatedAt: saved.updatedAt }, 409);
    return json(saved);
  } catch (error) {
    return errorResponse(error);
  }
}
