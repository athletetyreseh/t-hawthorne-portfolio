import {
  errorResponse,
  json,
  parseBody,
  requireSameOrigin,
  saveSchedulerState
} from "../../../_shared/scheduler.js";
import { SchedulerCommandError, executeSchedulerCommand } from "../../../_shared/scheduler-commands.js";

// Auth is supplied by the scheduler middleware. This endpoint deliberately
// accepts the same authenticated, same-origin browser session as cloud sync;
// it does not create a public or bearer-token schedule API.
export async function onRequestPost(context) {
  try {
    if (!requireSameOrigin(context.request)) return json({ error: "Invalid request origin" }, 403);
    const body = await parseBody(context.request);
    const ownerEmail = context.data.schedulerUser;
    const current = await context.env.SCHEDULER_DB.prepare(
      "SELECT state_json, revision FROM scheduler_state WHERE owner_email = ?"
    ).bind(ownerEmail).first();
    if (!current) return json({ error: "No cloud schedule exists" }, 404);

    let state;
    try { state = JSON.parse(current.state_json); }
    catch { return json({ error: "Stored schedule data is invalid" }, 500); }
    const execution = executeSchedulerCommand(state, body.command);

    // Save/sync commands are useful acknowledgement points for voice agents.
    // Mutations must include the revision observed from GET api/state so a
    // stale agent never overwrites a more recent browser or agent update.
    if (!execution.changed) {
      return json({ ok: true, changed: false, revision: current.revision, result: execution.result });
    }
    const baseRevision = Number(body.baseRevision);
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 1) {
      return json({ error: "baseRevision is required for a mutating command", code: "required_revision", revision: current.revision }, 409);
    }
    // Direct mutations always add their own pre-change restore point. That
    // gives a voice agent an exact, safe undo even when browser history's
    // normal five-minute retention throttle is active.
    const saved = await saveSchedulerState(context.env.SCHEDULER_DB, ownerEmail, execution.state, { baseRevision, historyAlways: true });
    if (saved.conflict) {
      return json({ error: "Cloud schedule changed", code: "revision_conflict", revision: saved.revision, updatedAt: saved.updatedAt }, 409);
    }
    return json({ ok: true, changed: true, revision: saved.revision, updatedAt: saved.updatedAt, result: execution.result });
  } catch (error) {
    if (error instanceof SchedulerCommandError) {
      return json({ error: error.message, code: error.code, details: error.details }, error.status);
    }
    return errorResponse(error);
  }
}
