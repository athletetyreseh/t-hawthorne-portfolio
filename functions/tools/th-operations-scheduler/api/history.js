import { errorResponse, json } from "../../../_shared/scheduler.js";

export async function onRequestGet(context) {
  try {
    const ownerEmail = context.data.schedulerUser;
    const result = await context.env.SCHEDULER_DB.prepare(
      "SELECT id, revision, created_at FROM scheduler_history WHERE owner_email = ? ORDER BY id DESC LIMIT 30"
    ).bind(ownerEmail).all();
    return json({
      versions: (result.results || []).map((row) => ({
        id: row.id,
        revision: row.revision,
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    return errorResponse(error);
  }
}
