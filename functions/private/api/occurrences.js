import { json, parseJson, privateErrorResponse, requireResourceAccess, requireSameOrigin } from "../../_shared/private-access.js";

const POINTS = Object.freeze({
  call_off: 2,
  no_call_no_show: 4,
  late: 1,
  left_early: 1,
  documentation: 0
});

const clean = (value, max) => String(value || "").trim().slice(0, max);

export async function onRequestGet(context) {
  try {
    const access = await requireResourceAccess(context, "staff", "view");
    if (access.response) return access.response;
    const staffId = Number(new URL(context.request.url).searchParams.get("staffId") || 0);
    const query = staffId > 0
      ? context.env.SCHEDULER_DB.prepare(
        `SELECT o.id, o.staff_id, s.full_name, o.occurrence_date, o.occurrence_type, o.points, o.notes, o.created_at, o.updated_at
         FROM staff_occurrences o JOIN staff_records s ON s.id = o.staff_id
         WHERE o.staff_id = ? ORDER BY o.occurrence_date DESC, o.id DESC`
      ).bind(staffId)
      : context.env.SCHEDULER_DB.prepare(
        `SELECT o.id, o.staff_id, s.full_name, o.occurrence_date, o.occurrence_type, o.points, o.notes, o.created_at, o.updated_at
         FROM staff_occurrences o JOIN staff_records s ON s.id = o.staff_id
         ORDER BY o.occurrence_date DESC, o.id DESC LIMIT 5000`
      );
    const result = await query.all();
    return json({ occurrences: result.results || [], accessLevel: access.accessLevel, pointRules: POINTS });
  } catch (error) {
    return privateErrorResponse(error);
  }
}

export async function onRequestPost(context) {
  return saveOccurrence(context, false);
}

export async function onRequestPatch(context) {
  return saveOccurrence(context, true);
}

async function saveOccurrence(context, updating) {
  try {
    const access = await requireResourceAccess(context, "staff", "edit");
    if (access.response) return access.response;
    if (!requireSameOrigin(context.request)) return json({ error: "Invalid request origin" }, 403);
    const body = await parseJson(context.request);
    const id = Number(body.id || 0);
    const staffId = Number(body.staffId);
    const occurrenceDate = clean(body.occurrenceDate, 10);
    const occurrenceType = clean(body.occurrenceType, 40);
    const notes = clean(body.notes, 2000);
    if (!Number.isInteger(staffId) || staffId <= 0) return json({ error: "Staff member is required" }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurrenceDate)) return json({ error: "Occurrence date is required" }, 400);
    if (!(occurrenceType in POINTS)) return json({ error: "Valid occurrence type is required" }, 400);
    const staff = await context.env.SCHEDULER_DB.prepare("SELECT id FROM staff_records WHERE id = ?").bind(staffId).first();
    if (!staff) return json({ error: "Staff member was not found" }, 404);
    const now = new Date().toISOString();
    const actor = context.data.privateUser.email;
    if (updating) {
      if (!Number.isInteger(id) || id <= 0) return json({ error: "Occurrence record is required" }, 400);
      const result = await context.env.SCHEDULER_DB.prepare(
        `UPDATE staff_occurrences SET staff_id = ?, occurrence_date = ?, occurrence_type = ?, points = ?, notes = ?, updated_at = ?, updated_by = ? WHERE id = ?`
      ).bind(staffId, occurrenceDate, occurrenceType, POINTS[occurrenceType], notes, now, actor, id).run();
      if (!result.meta?.changes) return json({ error: "Occurrence record was not found" }, 404);
      return json({ ok: true, points: POINTS[occurrenceType] });
    }
    const result = await context.env.SCHEDULER_DB.prepare(
      `INSERT INTO staff_occurrences (staff_id, occurrence_date, occurrence_type, points, notes, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(staffId, occurrenceDate, occurrenceType, POINTS[occurrenceType], notes, now, actor, now, actor).run();
    return json({ id: result.meta?.last_row_id, points: POINTS[occurrenceType] }, 201);
  } catch (error) {
    return privateErrorResponse(error);
  }
}

export async function onRequestDelete(context) {
  try {
    const access = await requireResourceAccess(context, "staff", "edit");
    if (access.response) return access.response;
    if (!requireSameOrigin(context.request)) return json({ error: "Invalid request origin" }, 403);
    const body = await parseJson(context.request);
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return json({ error: "Occurrence record is required" }, 400);
    const result = await context.env.SCHEDULER_DB.prepare("DELETE FROM staff_occurrences WHERE id = ?").bind(id).run();
    if (!result.meta?.changes) return json({ error: "Occurrence record was not found" }, 404);
    return json({ ok: true });
  } catch (error) {
    return privateErrorResponse(error);
  }
}
