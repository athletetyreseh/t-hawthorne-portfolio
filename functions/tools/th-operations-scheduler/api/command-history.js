import { errorResponse, json } from "../../../_shared/scheduler.js";
import { historyEvents, parseSchedulerSnapshot } from "../../../_shared/scheduler-history.js";

const integerParameter = (value, fallback, minimum, maximum) => {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
};

// This is a read-only, authenticated command companion. It deliberately
// returns summaries by default; a caller must explicitly ask for one snapshot.
export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const limit = integerParameter(url.searchParams.get("limit"), 20, 1, 30);
    const versionId = integerParameter(url.searchParams.get("versionId"), null, 1, Number.MAX_SAFE_INTEGER);
    const includeState = url.searchParams.get("includeState") === "true";
    if (limit == null || (url.searchParams.has("versionId") && versionId == null)) {
      return json({ error: "Invalid history query" }, 400);
    }
    if (includeState && !versionId) return json({ error: "includeState requires versionId" }, 400);

    const ownerEmail = context.data.schedulerUser;
    const current = await context.env.SCHEDULER_DB.prepare(
      "SELECT state_json, revision, updated_at FROM scheduler_state WHERE owner_email = ?"
    ).bind(ownerEmail).first();
    if (!current) return json({ error: "No cloud schedule exists" }, 404);
    const result = await context.env.SCHEDULER_DB.prepare(
      "SELECT id, revision, state_json, created_at FROM scheduler_history WHERE owner_email = ? ORDER BY id DESC LIMIT ?"
    ).bind(ownerEmail, 30).all();
    const events = historyEvents(
      { state: parseSchedulerSnapshot(current.state_json), revision: current.revision, updated_at: current.updated_at },
      result.results || []
    );
    const selected = versionId == null ? null : events.find((event) => event.id === versionId);
    if (versionId != null && !selected) return json({ error: "Restore point was not found" }, 404);
    const selectedRow = versionId == null ? null : (result.results || []).find((row) => row.id === versionId);
    const present = (event) => ({
      id: event.id,
      fromRevision: event.fromRevision,
      toRevision: event.toRevision,
      createdAt: event.createdAt,
      singleRevision: event.singleRevision,
      changes: event.changes,
      totalChanges: event.totalChanges,
      truncated: event.truncated
    });
    return json({
      current: { revision: current.revision, updatedAt: current.updated_at },
      latestChange: events[0] ? present(events[0]) : null,
      versions: versionId == null ? events.slice(0, limit).map(present) : [present(selected)],
      snapshot: includeState ? parseSchedulerSnapshot(selectedRow.state_json) : undefined
    });
  } catch (error) {
    return errorResponse(error);
  }
}
