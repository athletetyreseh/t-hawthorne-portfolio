import {
  json,
  parseJson,
  privateErrorResponse,
  requireResourceAccess,
  requireSameOrigin
} from "../../_shared/private-access.js";

const clean = (value, max) => String(value || "").trim().slice(0, max);
const statusFor = (value) => ["active", "leave", "inactive"].includes(value) ? value : "active";

const staffPayload = (body) => ({
  fullName: clean(body.fullName, 120),
  roleTitle: clean(body.roleTitle, 120),
  site: clean(body.site, 120),
  email: clean(body.email, 200).toLowerCase(),
  phone: clean(body.phone, 40),
  status: statusFor(body.status),
  notes: clean(body.notes, 2000)
});

export async function onRequestGet(context) {
  try {
    const access = await requireResourceAccess(context, "staff", "view");
    if (access.response) return access.response;
    const result = await context.env.SCHEDULER_DB.prepare(
      `SELECT id, full_name, role_title, site, email, phone, status, notes, created_at, updated_at
       FROM staff_records ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'leave' THEN 1 ELSE 2 END, full_name COLLATE NOCASE`
    ).all();
    return json({ staff: result.results || [], accessLevel: access.accessLevel });
  } catch (error) {
    return privateErrorResponse(error);
  }
}

export async function onRequestPost(context) {
  try {
    const access = await requireResourceAccess(context, "staff", "edit");
    if (access.response) return access.response;
    if (!requireSameOrigin(context.request)) return json({ error: "Invalid request origin" }, 403);
    const record = staffPayload(await parseJson(context.request));
    if (!record.fullName) return json({ error: "Staff name is required" }, 400);
    const now = new Date().toISOString();
    const actor = context.data.privateUser.email;
    const result = await context.env.SCHEDULER_DB.prepare(
      `INSERT INTO staff_records
       (full_name, role_title, site, email, phone, status, notes, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(record.fullName, record.roleTitle, record.site, record.email, record.phone, record.status, record.notes, now, actor, now, actor).run();
    return json({ id: result.meta?.last_row_id }, 201);
  } catch (error) {
    return privateErrorResponse(error);
  }
}

export async function onRequestPatch(context) {
  try {
    const access = await requireResourceAccess(context, "staff", "edit");
    if (access.response) return access.response;
    if (!requireSameOrigin(context.request)) return json({ error: "Invalid request origin" }, 403);
    const body = await parseJson(context.request);
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return json({ error: "Valid staff record is required" }, 400);
    const record = staffPayload(body);
    if (!record.fullName) return json({ error: "Staff name is required" }, 400);
    const result = await context.env.SCHEDULER_DB.prepare(
      `UPDATE staff_records SET full_name = ?, role_title = ?, site = ?, email = ?, phone = ?, status = ?, notes = ?, updated_at = ?, updated_by = ?
       WHERE id = ?`
    ).bind(record.fullName, record.roleTitle, record.site, record.email, record.phone, record.status, record.notes, new Date().toISOString(), context.data.privateUser.email, id).run();
    if (!result.meta?.changes) return json({ error: "Staff record was not found" }, 404);
    return json({ ok: true });
  } catch (error) {
    return privateErrorResponse(error);
  }
}
