import {
  ensureLifeManagerSchema,
  lifeManagerErrorResponse,
  normalizeUserCode,
  parseLifeManagerJson,
  randomToken
} from "../../../_shared/life-manager.js";
import { json } from "../../../_shared/private-access.js";

const newUserCode = () => normalizeUserCode(randomToken(6)).slice(0, 8).padEnd(8, "X");

export async function onRequestPost(context) {
  try {
    await ensureLifeManagerSchema(context.env.SCHEDULER_DB);
    const body = await parseLifeManagerJson(context.request, 20_000);
    const deviceId = String(body.deviceId || "").trim();
    const deviceName = String(body.deviceName || "Android phone").trim().slice(0, 80);
    const challenge = String(body.challenge || "").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(challenge)) return json({ error: "Invalid pairing challenge" }, 400);
    if (!/^[A-Za-z0-9._-]{8,160}$/.test(deviceId)) return json({ error: "Invalid device id" }, 400);
    const id = randomToken(24);
    let userCode = newUserCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const exists = await context.env.SCHEDULER_DB.prepare(
        "SELECT 1 FROM life_manager_pairings WHERE user_code = ?"
      ).bind(userCode).first();
      if (!exists) break;
      userCode = newUserCode();
    }
    const now = new Date();
    const expiresAt = new Date(now.valueOf() + 10 * 60 * 1000);
    await context.env.SCHEDULER_DB.prepare(
      `INSERT INTO life_manager_pairings
        (id, user_code, device_id, device_name, verifier_challenge, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).bind(id, userCode, deviceId, deviceName, challenge, now.toISOString(), expiresAt.toISOString()).run();
    return json({
      pairingId: id,
      userCode,
      verificationUrl: `https://t-hawthorne.com/private/life-manager/connect/?code=${encodeURIComponent(userCode)}`,
      expiresAt: expiresAt.toISOString()
    }, 201);
  } catch (error) {
    return lifeManagerErrorResponse(error);
  }
}
