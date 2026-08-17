import {
  ensureLifeManagerSchema,
  lifeManagerErrorResponse,
  parseLifeManagerJson,
  randomToken,
  sha256
} from "../../../_shared/life-manager.js";
import { json } from "../../../_shared/private-access.js";

export async function onRequestPost(context) {
  try {
    await ensureLifeManagerSchema(context.env.SCHEDULER_DB);
    const body = await parseLifeManagerJson(context.request, 20_000);
    const pairingId = String(body.pairingId || "");
    const verifier = String(body.verifier || "");
    const pairing = await context.env.SCHEDULER_DB.prepare(
      "SELECT * FROM life_manager_pairings WHERE id = ?"
    ).bind(pairingId).first();
    if (!pairing || new Date(pairing.expires_at) <= new Date()) return json({ error: "Pairing request expired" }, 410);
    if (pairing.status === "pending") return json({ status: "pending" }, 202);
    if (pairing.status === "consumed") return json({ error: "Pairing request was already used" }, 409);
    if (await sha256(verifier) !== pairing.verifier_challenge) return json({ error: "Invalid pairing verifier" }, 403);
    const pepper = String(context.env.LIFE_MANAGER_TOKEN_PEPPER || "");
    if (!pepper) return json({ error: "Life Manager cloud is not configured" }, 503);
    const token = `lm_${randomToken(40)}`;
    const tokenHash = await sha256(`${token}:${pepper}`);
    const now = new Date().toISOString();
    await context.env.SCHEDULER_DB.batch([
      context.env.SCHEDULER_DB.prepare(
        `INSERT INTO life_manager_devices
          (owner_email, device_id, device_name, token_hash, created_at, last_seen_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(owner_email, device_id) DO UPDATE SET
           device_name = excluded.device_name, token_hash = excluded.token_hash,
           last_seen_at = excluded.last_seen_at, revoked_at = NULL`
      ).bind(pairing.owner_email, pairing.device_id, pairing.device_name, tokenHash, now, now),
      context.env.SCHEDULER_DB.prepare(
        "UPDATE life_manager_pairings SET status = 'consumed', consumed_at = ? WHERE id = ?"
      ).bind(now, pairingId)
    ]);
    return json({
      status: "connected",
      token,
      ownerEmail: pairing.owner_email,
      deviceId: pairing.device_id,
      deviceName: pairing.device_name
    });
  } catch (error) {
    return lifeManagerErrorResponse(error);
  }
}
