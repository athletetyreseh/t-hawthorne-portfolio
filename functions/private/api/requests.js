import {
  RESOURCE_CATALOG,
  json,
  parseJson,
  privateErrorResponse,
  requireAdmin,
  requireSameOrigin
} from "../../_shared/private-access.js";

export async function onRequestGet(context) {
  try {
    const adminError = requireAdmin(context);
    if (adminError) return adminError;
    const result = await context.env.SCHEDULER_DB.prepare(
      `SELECT id, user_email, resource_key, requested_level, message, status, requested_at, resolved_at, resolved_by
       FROM access_requests ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, requested_at DESC LIMIT 250`
    ).all();
    return json({ requests: result.results || [] });
  } catch (error) {
    return privateErrorResponse(error);
  }
}

export async function onRequestPost(context) {
  try {
    if (!requireSameOrigin(context.request)) return json({ error: "Invalid request origin" }, 403);
    const body = await parseJson(context.request);
    const resourceKey = String(body.resourceKey || "");
    const resource = RESOURCE_CATALOG[resourceKey];
    if (!resource) return json({ error: "Unknown private resource" }, 400);
    const requestedLevel = body.requestedLevel === "edit" ? "edit" : resource.requestLevel;
    const message = String(body.message || "").trim().slice(0, 500);
    const existing = await context.env.SCHEDULER_DB.prepare(
      "SELECT id FROM access_requests WHERE user_email = ? AND resource_key = ? AND status = 'pending'"
    ).bind(context.data.privateUser.email, resourceKey).first();
    if (existing) return json({ requestId: existing.id, status: "pending" });
    const result = await context.env.SCHEDULER_DB.prepare(
      `INSERT INTO access_requests (user_email, resource_key, requested_level, message, status, requested_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`
    ).bind(context.data.privateUser.email, resourceKey, requestedLevel, message, new Date().toISOString()).run();
    return json({ requestId: result.meta?.last_row_id, status: "pending" }, 201);
  } catch (error) {
    return privateErrorResponse(error);
  }
}
