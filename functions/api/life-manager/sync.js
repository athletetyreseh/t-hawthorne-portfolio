import {
  applyRecordChange,
  authenticateLifeManagerDevice,
  lifeManagerErrorResponse,
  parseLifeManagerJson,
  recordsSince
} from "../../_shared/life-manager.js";
import { json } from "../../_shared/private-access.js";

export async function onRequestPost(context) {
  try {
    const authentication = await authenticateLifeManagerDevice(context);
    if (authentication.response) return authentication.response;
    const body = await parseLifeManagerJson(context.request);
    const changes = Array.isArray(body.changes) ? body.changes.slice(0, 500) : [];
    const ownerEmail = authentication.device.owner_email;
    const actor = `device:${authentication.device.device_id}`;
    const results = [];
    for (const change of changes) {
      results.push(await applyRecordChange(context.env.SCHEDULER_DB, ownerEmail, change, actor));
    }
    const delta = await recordsSince(context.env.SCHEDULER_DB, ownerEmail, body.cursor || 0);
    return json({ ...delta, results });
  } catch (error) {
    return lifeManagerErrorResponse(error);
  }
}
