import { json, parseJson, privateErrorResponse, requireSameOrigin } from "../../../_shared/private-access.js";
import {
  REQUEST_STATUSES,
  cleanText,
  ensureOfficerScheduleSchema,
  publicSchedulePayload
} from "../../../_shared/officer-schedule.js";

export async function onRequestGet(context) {
  try {
    return json(await publicSchedulePayload(context, true));
  } catch (error) {
    return privateErrorResponse(error);
  }
}

export async function onRequestPatch(context) {
  try {
    if (!requireSameOrigin(context.request)) return json({ error: "Invalid request origin" }, 403);
    await ensureOfficerScheduleSchema(context.env.SCHEDULER_DB);
    const body = await parseJson(context.request, 10_000);
    const id = cleanText(body.id, 80);
    const status = cleanText(body.status, 20);
    const denialMessage = cleanText(body.denialMessage, 1000);
    if (!id) return json({ error: "Request id is required" }, 400);
    if (!REQUEST_STATUSES.has(status) || status === "pending") return json({ error: "Status must be approved or denied" }, 400);
    if (status === "denied" && !denialMessage) return json({ error: "Denial message is required" }, 400);

    const result = await context.env.SCHEDULER_DB.prepare(
      `UPDATE officer_schedule_requests
       SET status = ?, denial_message = ?, resolved_at = ?, resolved_by = ?
       WHERE id = ? AND owner_email = ?`
    ).bind(
      status,
      status === "denied" ? denialMessage : "",
      new Date().toISOString(),
      context.data.privateUser?.email || "",
      id,
      context.data.schedulerUser
    ).run();
    if (!result.meta?.changes) return json({ error: "Request was not found" }, 404);
    return json({ ok: true });
  } catch (error) {
    return privateErrorResponse(error);
  }
}
