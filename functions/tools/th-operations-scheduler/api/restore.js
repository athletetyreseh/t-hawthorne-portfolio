import {
  errorResponse,
  json,
  parseBody,
  pruneHistory,
  requireSameOrigin,
  stateResponse
} from "../../../_shared/scheduler.js";

export async function onRequestPost(context) {
  try {
    if (!requireSameOrigin(context.request)) return json({ error: "Invalid request origin" }, 403);
    const ownerEmail = context.data.schedulerUser;
    const body = await parseBody(context.request);
    const versionId = Number(body.versionId);
    if (!Number.isInteger(versionId) || versionId <= 0) return json({ error: "A valid restore point is required" }, 400);

    const version = await context.env.SCHEDULER_DB.prepare(
      "SELECT state_json, revision, created_at FROM scheduler_history WHERE owner_email = ? AND id = ?"
    ).bind(ownerEmail, versionId).first();
    if (!version) return json({ error: "Restore point was not found" }, 404);

    const current = await context.env.SCHEDULER_DB.prepare(
      "SELECT state_json, revision, updated_at FROM scheduler_state WHERE owner_email = ?"
    ).bind(ownerEmail).first();
    if (!current) return json({ error: "Current cloud schedule was not found" }, 404);

    const now = new Date().toISOString();
    await context.env.SCHEDULER_DB.prepare(
      "INSERT INTO scheduler_history (owner_email, revision, state_json, created_at) VALUES (?, ?, ?, ?)"
    ).bind(ownerEmail, current.revision, current.state_json, now).run();
    await pruneHistory(context.env.SCHEDULER_DB, ownerEmail);

    const nextRevision = current.revision + 1;
    const result = await context.env.SCHEDULER_DB.prepare(
      "UPDATE scheduler_state SET state_json = ?, revision = ?, updated_at = ? WHERE owner_email = ? AND revision = ?"
    ).bind(version.state_json, nextRevision, now, ownerEmail, current.revision).run();
    if (!result.meta?.changes) return json({ error: "Cloud schedule changed while restoring" }, 409);

    return stateResponse({ state_json: version.state_json, revision: nextRevision, updated_at: now });
  } catch (error) {
    return errorResponse(error);
  }
}
