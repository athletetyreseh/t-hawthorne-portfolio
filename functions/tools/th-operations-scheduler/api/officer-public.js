import { json, privateErrorResponse, requireSameOrigin, ownerEmailFor } from "../../../_shared/private-access.js";
import {
  ensureOfficerScheduleSchema,
  parseAcknowledgement,
  parseOfficerRequest,
  publicSchedulePayload
} from "../../../_shared/officer-schedule.js";

export async function onRequestGet(context) {
  try {
    return json(await publicSchedulePayload(context, false));
  } catch (error) {
    return privateErrorResponse(error);
  }
}

export async function onRequestPost(context) {
  try {
    if (!requireSameOrigin(context.request)) return json({ error: "Invalid request origin" }, 403);
    const url = new URL(context.request.url);
    const action = url.searchParams.get("action") || "request";
    const database = context.env.SCHEDULER_DB;
    const ownerEmail = ownerEmailFor(context);
    await ensureOfficerScheduleSchema(database);

    if (action === "acknowledge") {
      const acknowledgement = await parseAcknowledgement(context.request);
      await database.prepare(
        `INSERT INTO officer_schedule_acknowledgements
         (id, owner_email, officer_name, officer_email, week_start, signature_data, signed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_email, officer_name, week_start) DO UPDATE SET
           officer_email = excluded.officer_email,
           signature_data = excluded.signature_data,
           signed_at = excluded.signed_at`
      ).bind(
        acknowledgement.id,
        ownerEmail,
        acknowledgement.officerName,
        acknowledgement.officerEmail,
        acknowledgement.weekStart,
        acknowledgement.signatureData,
        acknowledgement.signedAt
      ).run();
      return json({ ok: true, signedAt: acknowledgement.signedAt }, 201);
    }

    const request = await parseOfficerRequest(context.request);
    await database.prepare(
      `INSERT INTO officer_schedule_requests
       (id, owner_email, officer_name, officer_email, request_type, start_date, end_date, requested_time, message, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).bind(
      request.id,
      ownerEmail,
      request.officerName,
      request.officerEmail,
      request.type,
      request.startDate,
      request.endDate,
      request.requestedTime,
      request.message,
      request.createdAt
    ).run();
    return json({ ok: true, requestId: request.id }, 201);
  } catch (error) {
    return privateErrorResponse(error);
  }
}
