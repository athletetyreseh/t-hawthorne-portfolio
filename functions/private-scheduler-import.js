import {
  errorResponse,
  json,
  parseBody,
  serializeValidatedState
} from "./_shared/scheduler.js";

// Temporary one-time migration route. It refuses to run once the owner's
// scheduler row exists and is removed from the site immediately after import.
export async function onRequestPost(context) {
  try {
    const configuredSecret = String(context.env.SCHEDULER_IMPORT_SECRET || "");
    const suppliedSecret = String(context.request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!configuredSecret || suppliedSecret !== configuredSecret) return json({ error: "Not found" }, 404);

    const ownerEmail = String(context.env.OWNER_EMAIL || "").trim().toLowerCase();
    if (!ownerEmail || !context.env.SCHEDULER_DB) return json({ error: "Import is not configured" }, 503);

    const existing = await context.env.SCHEDULER_DB.prepare(
      "SELECT revision FROM scheduler_state WHERE owner_email = ?"
    ).bind(ownerEmail).first();
    if (existing) return json({ error: "The private schedule is already initialized" }, 409);

    const body = await parseBody(context.request);
    const serialized = serializeValidatedState(body.state);
    const now = new Date().toISOString();
    const result = await context.env.SCHEDULER_DB.prepare(
      "INSERT OR IGNORE INTO scheduler_state (owner_email, state_json, revision, updated_at) VALUES (?, ?, 1, ?)"
    ).bind(ownerEmail, serialized, now).run();
    if (!result.meta?.changes) return json({ error: "The private schedule is already initialized" }, 409);

    return json({ imported: true, revision: 1, updatedAt: now }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export function onRequest() {
  return json({ error: "Not found" }, 404);
}
