import { json, parseJson, privateErrorResponse, requireSameOrigin } from "../../../_shared/private-access.js";
import {
  REQUEST_STATUSES,
  cleanText,
  ensureOfficerScheduleSchema,
  acknowledgementFromRow,
  isIsoDate,
  overtimeRequestFromRow,
  requestFromRow
} from "../../../_shared/officer-schedule.js";

import { resolveOvertimeRequest, isOvertimePreview } from "../../../_shared/overtime.js";

const officerRequestSummary = async (database, ownerEmail) => {
  await ensureOfficerScheduleSchema(database);
  const [requestsResult, overtimeResult] = await Promise.all([
    database.prepare(`SELECT id, officer_name, request_type, start_date, end_date, status, created_at
      FROM officer_schedule_requests
      WHERE owner_email = ?
      ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC
      LIMIT 500`).bind(ownerEmail).all(),
    database.prepare(`SELECT id, officer_name, shift_date, row_id, status, created_at
      FROM officer_schedule_overtime_requests
      WHERE owner_email = ?
      ORDER BY created_at DESC
      LIMIT 500`).bind(ownerEmail).all()
  ]);
  const allRequests = [
    ...(requestsResult.results || []).map((row) => ({
      id: row.id, officerName: row.officer_name, type: row.request_type,
      startDate: row.start_date, endDate: row.end_date, rowId: "",
      status: row.status, createdAt: row.created_at
    })),
    ...(overtimeResult.results || []).map((row) => ({
      id: row.id, officerName: row.officer_name, type: "overtime",
      startDate: row.shift_date, endDate: row.shift_date, rowId: row.row_id,
      status: row.status, createdAt: row.created_at
    }))
  ].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || b.createdAt.localeCompare(a.createdAt)).slice(0, 500);
  const requests = allRequests
    .filter((request) => request.status === "pending" || (request.status === "approved" && ["pto", "unpaid"].includes(request.type)))
    .map(({ createdAt, ...request }) => request);
  return { requests, pendingCount: allRequests.filter((request) => request.status === "pending").length };
};

const officerRequestDetails = async (database, ownerEmail, weekStart) => {
  await ensureOfficerScheduleSchema(database);
  const selectedWeek = isIsoDate(weekStart) ? weekStart : "";
  const acknowledgementsQuery = selectedWeek
    ? database.prepare(`SELECT id, officer_name, officer_email, week_start, signature_data, signed_at
        FROM officer_schedule_acknowledgements
        WHERE owner_email = ? AND week_start = ?
        ORDER BY signed_at DESC
        LIMIT 500`).bind(ownerEmail, selectedWeek)
    : database.prepare(`SELECT id, officer_name, officer_email, week_start, signature_data, signed_at
        FROM officer_schedule_acknowledgements
        WHERE owner_email = ? AND week_start = (
          SELECT MAX(week_start) FROM officer_schedule_acknowledgements WHERE owner_email = ?
        )
        ORDER BY signed_at DESC
        LIMIT 500`).bind(ownerEmail, ownerEmail);

  const [requestsResult, overtimeResult, acknowledgementsResult] = await Promise.all([
    database.prepare(`SELECT request.id, request.officer_name,
        COALESCE(NULLIF(request.officer_email, ''), (
          SELECT staff.email FROM staff_records AS staff
          WHERE staff.status != 'inactive'
            AND lower(trim(staff.full_name)) = lower(trim(request.officer_name))
          ORDER BY staff.full_name COLLATE NOCASE
          LIMIT 1
        ), '') AS officer_email,
        request.request_type, request.start_date, request.end_date, request.requested_time,
        request.message, request.status, request.denial_message, request.created_at,
        request.resolved_at, request.resolved_by
      FROM officer_schedule_requests AS request
      WHERE request.owner_email = ?
      ORDER BY CASE request.status WHEN 'pending' THEN 0 ELSE 1 END, request.created_at DESC
      LIMIT 500`).bind(ownerEmail).all(),
    database.prepare(`SELECT overtime.id, overtime.row_id, overtime.shift_date, overtime.site, overtime.post,
        overtime.shift_name, overtime.start_time, overtime.end_time, overtime.officer_name,
        COALESCE(NULLIF(overtime.officer_email, ''), (
          SELECT staff.email FROM staff_records AS staff
          WHERE staff.status != 'inactive'
            AND lower(trim(staff.full_name)) = lower(trim(overtime.officer_name))
          ORDER BY staff.full_name COLLATE NOCASE
          LIMIT 1
        ), '') AS officer_email,
        overtime.message, overtime.status, overtime.denial_message, overtime.created_at,
        overtime.resolved_at, overtime.resolved_by
      FROM officer_schedule_overtime_requests AS overtime
      WHERE overtime.owner_email = ?
      ORDER BY overtime.created_at DESC
      LIMIT 500`).bind(ownerEmail).all(),
    acknowledgementsQuery.all()
  ]);

  const requests = [
    ...(requestsResult.results || []).map(requestFromRow),
    ...(overtimeResult.results || []).map((row) => overtimeRequestFromRow(row, true))
  ].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || b.createdAt.localeCompare(a.createdAt)).slice(0, 500);
  const officersByName = new Map();
  for (const request of requests) {
    const name = cleanText(request.officerName, 120);
    if (!name) continue;
    const key = name.toLowerCase();
    const email = String(request.officerEmail || "").trim().toLowerCase();
    const existing = officersByName.get(key);
    if (!existing || (!existing.email && email)) officersByName.set(key, { name, email });
  }
  const officers = [...officersByName.values()].sort((a, b) => a.name.localeCompare(b.name));

  return {
    revision: null,
    updatedAt: "",
    schedule: null,
    officers,
    requests,
    acknowledgements: (acknowledgementsResult.results || []).map((row) => acknowledgementFromRow(row, true))
  };
};



export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    if (url.searchParams.get("summary") === "1") {
      return json(await officerRequestSummary(context.env.SCHEDULER_DB, context.data.schedulerUser));
    }
    return json(await officerRequestDetails(
      context.env.SCHEDULER_DB,
      context.data.schedulerUser,
      url.searchParams.get("weekStart") || ""
    ));
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

    const overtime = await context.env.SCHEDULER_DB.prepare("SELECT * FROM officer_schedule_overtime_requests WHERE id = ? AND owner_email = ?").bind(id, context.data.schedulerUser).first();
    if (overtime) return await resolveOvertimeRequest(context, overtime, status, denialMessage);

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

export async function onRequestDelete(context) {
  try {
    if (!requireSameOrigin(context.request)) return json({ error: "Invalid request origin" }, 403);
    await ensureOfficerScheduleSchema(context.env.SCHEDULER_DB);
    const body = await parseJson(context.request, 10_000);
    const id = cleanText(body.id, 80);
    if (!id) return json({ error: "Request id is required" }, 400);

    const overtime = await context.env.SCHEDULER_DB.prepare("SELECT id FROM officer_schedule_overtime_requests WHERE id = ? AND owner_email = ?").bind(id, context.data.schedulerUser).first();
    if (overtime) {
      if (isOvertimePreview(context)) return json({ error: "The preview cannot delete live overtime requests." }, 403);
      await context.env.SCHEDULER_DB.prepare("DELETE FROM officer_schedule_overtime_requests WHERE id = ? AND owner_email = ?").bind(id, context.data.schedulerUser).run();
      return json({ ok: true });
    }
    const result = await context.env.SCHEDULER_DB.prepare(
      "DELETE FROM officer_schedule_requests WHERE id = ? AND owner_email = ?"
    ).bind(id, context.data.schedulerUser).run();
    if (!result.meta?.changes) return json({ error: "Request was not found" }, 404);
    return json({ ok: true });
  } catch (error) {
    return privateErrorResponse(error);
  }
}
