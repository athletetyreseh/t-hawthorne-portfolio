import { RESOURCE_CATALOG, getAccessLevel, ownerEmailFor, privateErrorResponse, json } from "../../_shared/private-access.js";

export async function onRequestGet(context) {
  try {
    const user = context.data.privateUser;
    const ownerEmail = ownerEmailFor(context);
    const pending = await context.env.SCHEDULER_DB.prepare(
      "SELECT resource_key, requested_level, status, requested_at FROM access_requests WHERE user_email = ? AND status = 'pending'"
    ).bind(user.email).all();
    const pendingByResource = new Map((pending.results || []).map((row) => [row.resource_key, row]));
    const resources = await Promise.all(Object.entries(RESOURCE_CATALOG).map(async ([key, resource]) => ({
      key,
      ...resource,
      accessLevel: await getAccessLevel(context.env.SCHEDULER_DB, user.email, key, ownerEmail),
      request: pendingByResource.get(key) || null
    })));
    return json({ user, resources });
  } catch (error) {
    return privateErrorResponse(error);
  }
}
