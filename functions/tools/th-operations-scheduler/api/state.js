import {
  errorResponse,
  json,
  maybeCreateHistory,
  parseBody,
  requireSameOrigin,
  serializeValidatedState,
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
    const serialized = serializeValidatedState(body.state);
    const force = body.force === true;
    const baseRevision = body.baseRevision == null ? null : Number(body.baseRevision);
    const now = new Date().toISOString();

    const current = await context.env.SCHEDULER_DB.prepare(
      "SELECT state_json, revision, updated_at FROM scheduler_state WHERE owner_email = ?"
    ).bind(ownerEmail).first();

    if (!current) {
      const result = await context.env.SCHEDULER_DB.prepare(
        "INSERT OR IGNORE INTO scheduler_state (owner_email, state_json, revision, updated_at) VALUES (?, ?, 1, ?)"
      ).bind(ownerEmail, serialized, now).run();
      if (!result.meta?.changes) {
        const raced = await context.env.SCHEDULER_DB.prepare(
          "SELECT revision, updated_at FROM scheduler_state WHERE owner_email = ?"
        ).bind(ownerEmail).first();
        return json({ error: "Cloud schedule changed", revision: raced?.revision, updatedAt: raced?.updated_at }, 409);
      }
      return json({ revision: 1, updatedAt: now });
    }

    if (!force && (!Number.isFinite(baseRevision) || baseRevision !== current.revision)) {
      return json({ error: "Cloud schedule changed", revision: current.revision, updatedAt: current.updated_at }, 409);
    }

    const nextRevision = current.revision + 1;
    const result = await context.env.SCHEDULER_DB.prepare(
      "UPDATE scheduler_state SET state_json = ?, revision = ?, updated_at = ? WHERE owner_email = ? AND revision = ?"
    ).bind(serialized, nextRevision, now, ownerEmail, current.revision).run();
    if (!result.meta?.changes) {
      const raced = await context.env.SCHEDULER_DB.prepare(
        "SELECT revision, updated_at FROM scheduler_state WHERE owner_email = ?"
      ).bind(ownerEmail).first();
      return json({ error: "Cloud schedule changed", revision: raced?.revision, updatedAt: raced?.updated_at }, 409);
    }

    await maybeCreateHistory(context.env.SCHEDULER_DB, ownerEmail, current, now);
    return json({ revision: nextRevision, updatedAt: now });
  } catch (error) {
    return errorResponse(error);
  }
}
