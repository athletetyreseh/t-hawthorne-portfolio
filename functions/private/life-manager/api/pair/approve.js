import {
  ensureLifeManagerSchema,
  lifeManagerErrorResponse,
  normalizeUserCode,
  parseLifeManagerJson
} from "../../../../_shared/life-manager.js";
import { json, requireAdmin, requireSameOrigin } from "../../../../_shared/private-access.js";

export async function onRequestPost(context) {
  try {
    const denied = requireAdmin(context);
    if (denied) return denied;
    if (!requireSameOrigin(context.request)) return json({ error: "Invalid request origin" }, 403);
    await ensureLifeManagerSchema(context.env.SCHEDULER_DB);
    const body = await parseLifeManagerJson(context.request, 10_000);
    const userCode = normalizeUserCode(body.userCode);
    const pairing = await context.env.SCHEDULER_DB.prepare(
      "SELECT * FROM life_manager_pairings WHERE user_code = ?"
    ).bind(userCode).first();
    if (!pairing || new Date(pairing.expires_at) <= new Date()) return json({ error: "Pairing code is invalid or expired" }, 404);
    if (pairing.status !== "pending") return json({ error: "Pairing code was already used" }, 409);
    const now = new Date().toISOString();
    await context.env.SCHEDULER_DB.prepare(
      "UPDATE life_manager_pairings SET owner_email = ?, status = 'approved', approved_at = ? WHERE id = ?"
    ).bind(context.data.privateUser.email, now, pairing.id).run();
    return json({ status: "approved", deviceName: pairing.device_name, expiresAt: pairing.expires_at });
  } catch (error) {
    return lifeManagerErrorResponse(error);
  }
}
