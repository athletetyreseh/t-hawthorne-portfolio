import { lifeManagerErrorResponse } from "../../../_shared/life-manager.js";
import { json, requireAdmin } from "../../../_shared/private-access.js";

export async function onRequestGet(context) {
  try {
    const denied = requireAdmin(context);
    if (denied) return denied;
    await context.env.SCHEDULER_DB.prepare("SELECT 1 AS ok").first();
    await context.env.LIFE_MANAGER_PHOTOS.list({ limit: 1 });
    return json({ database: "ready", photoStorage: "ready" });
  } catch (error) {
    return lifeManagerErrorResponse(error);
  }
}
