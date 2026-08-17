import { ensureLifeManagerSchema, lifeManagerErrorResponse, parseLifeManagerJson } from "../../../_shared/life-manager.js";
import { json, requireAdmin, requireSameOrigin } from "../../../_shared/private-access.js";

export async function onRequestGet(context) {
  try {
    const denied = requireAdmin(context);
    if (denied) return denied;
    await ensureLifeManagerSchema(context.env.SCHEDULER_DB);
    const result = await context.env.SCHEDULER_DB.prepare(
      `SELECT device_id, device_name, created_at, last_seen_at, revoked_at
       FROM life_manager_devices WHERE owner_email = ? ORDER BY last_seen_at DESC`
    ).bind(context.data.privateUser.email).all();
    return json({ devices: result.results || [] });
  } catch (error) {
    return lifeManagerErrorResponse(error);
  }
}

export async function onRequestDelete(context) {
  try {
    const denied = requireAdmin(context);
    if (denied) return denied;
    if (!requireSameOrigin(context.request)) return json({ error: "Invalid request origin" }, 403);
    const body = await parseLifeManagerJson(context.request, 10_000);
    const deviceId = String(body.deviceId || "");
    await context.env.SCHEDULER_DB.prepare(
      "UPDATE life_manager_devices SET revoked_at = ? WHERE owner_email = ? AND device_id = ?"
    ).bind(new Date().toISOString(), context.data.privateUser.email, deviceId).run();
    return json({ revoked: true });
  } catch (error) {
    return lifeManagerErrorResponse(error);
  }
}
