import {
  errorResponse,
  json,
  parseBody,
  requireSameOrigin,
  restoreSchedulerState
} from "../../../_shared/scheduler.js";

// Undo restores the newest recoverable state using the same restore code as
// the UI. The confirmation and revision check prevent a voice transcript from
// silently reverting schedule work or overwriting a newer change.
export async function onRequestPost(context) {
  try {
    if (!requireSameOrigin(context.request)) return json({ error: "Invalid request origin" }, 403);
    const body = await parseBody(context.request);
    if (body.confirm !== true) return json({ error: "undo_last requires confirm: true", code: "confirmation_required" }, 409);
    const baseRevision = Number(body.baseRevision);
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 1) {
      return json({ error: "baseRevision is required for undo_last", code: "required_revision" }, 409);
    }
    const ownerEmail = context.data.schedulerUser;
    const latest = await context.env.SCHEDULER_DB.prepare(
      "SELECT id FROM scheduler_history WHERE owner_email = ? ORDER BY id DESC LIMIT 1"
    ).bind(ownerEmail).first();
    if (!latest) return json({ error: "No restore point exists for undo", code: "undo_unavailable" }, 404);
    const restored = await restoreSchedulerState(context.env.SCHEDULER_DB, ownerEmail, Number(latest.id), { baseRevision });
    if (restored.notFound) return json({ error: "Restore point was not found" }, 404);
    if (restored.noCurrent) return json({ error: "No cloud schedule exists" }, 404);
    if (restored.conflict) return json({ error: "Cloud schedule changed", code: "revision_conflict", revision: restored.revision, updatedAt: restored.updatedAt }, 409);
    return json({ ok: true, changed: true, undoneVersionId: restored.restoredVersionId, revision: restored.revision, updatedAt: restored.updated_at });
  } catch (error) {
    return errorResponse(error);
  }
}
