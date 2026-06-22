import { json, parseJson, privateErrorResponse, requireResourceAccess, requireSameOrigin } from "../../_shared/private-access.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost(context) {
  try {
    const access = await requireResourceAccess(context, "staff", "edit");
    if (access.response) return access.response;
    if (!requireSameOrigin(context.request)) return json({ error: "Invalid request origin" }, 403);
    if (!context.env.RESEND_API_KEY || !context.env.STAFF_EMAIL_FROM) {
      return json({ error: "Direct email delivery is not configured", deliveryConfigured: false }, 503);
    }
    const body = await parseJson(context.request, 30_000);
    const ids = [...new Set((Array.isArray(body.staffIds) ? body.staffIds : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    const mode = body.mode === "separate" ? "separate" : "bcc";
    const subject = String(body.subject || "").trim().slice(0, 200);
    const message = String(body.body || "").trim().slice(0, 10_000);
    if (!ids.length) return json({ error: "Select at least one staff member" }, 400);
    if (!subject || !message) return json({ error: "Subject and message body are required" }, 400);
    if ((mode === "bcc" && ids.length > 50) || ids.length > 100) return json({ error: "Too many recipients selected" }, 400);

    const placeholders = ids.map(() => "?").join(",");
    const result = await context.env.SCHEDULER_DB.prepare(
      `SELECT id, full_name, email FROM staff_records WHERE id IN (${placeholders}) AND email != ''`
    ).bind(...ids).all();
    const recipients = (result.results || []).filter((record) => emailPattern.test(record.email));
    if (recipients.length !== ids.length) return json({ error: "Every selected staff member must have a valid email address" }, 400);

    const from = String(context.env.STAFF_EMAIL_FROM);
    const payload = mode === "bcc"
      ? { from, to: [context.data.privateUser.email], bcc: recipients.map((record) => record.email), subject, text: message }
      : recipients.map((record) => ({ from, to: [record.email], subject, text: message }));
    const endpoint = mode === "bcc" ? "https://api.resend.com/emails" : "https://api.resend.com/emails/batch";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${context.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID()
      },
      body: JSON.stringify(payload)
    });
    const responsePayload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Staff email provider rejected request", response.status, responsePayload);
      return json({ error: responsePayload.message || responsePayload.error?.message || "Email provider rejected the request" }, 502);
    }
    const providerIds = mode === "bcc"
      ? [responsePayload.id].filter(Boolean)
      : (responsePayload.data || []).map((item) => item.id).filter(Boolean);
    await context.env.SCHEDULER_DB.prepare(
      `INSERT INTO staff_email_log (sender_email, delivery_mode, recipient_count, subject, sent_at, provider_ids_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(context.data.privateUser.email, mode, recipients.length, subject, new Date().toISOString(), JSON.stringify(providerIds)).run();
    return json({ ok: true, recipientCount: recipients.length, mode });
  } catch (error) {
    return privateErrorResponse(error);
  }
}
