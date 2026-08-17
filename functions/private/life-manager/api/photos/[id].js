import { ensureLifeManagerSchema, lifeManagerErrorResponse } from "../../../../_shared/life-manager.js";
import { json, requireAdmin } from "../../../../_shared/private-access.js";

export async function onRequestGet(context) {
  try {
    const denied = requireAdmin(context);
    if (denied) return denied;
    await ensureLifeManagerSchema(context.env.SCHEDULER_DB);
    const photoId = String(context.params.id || "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 160);
    const row = await context.env.SCHEDULER_DB.prepare(
      "SELECT * FROM life_manager_photos WHERE owner_email = ? AND photo_id = ? AND deleted_at IS NULL"
    ).bind(context.data.privateUser.email, photoId).first();
    if (!row) return json({ error: "Photo not found" }, 404);
    const object = await context.env.LIFE_MANAGER_PHOTOS.get(row.object_key);
    if (!object) return json({ error: "Photo file is unavailable" }, 404);
    return new Response(object.body, {
      headers: {
        "Content-Type": row.content_type,
        "Content-Length": String(row.byte_size),
        "Cache-Control": "private, max-age=3600",
        "ETag": row.sha256,
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return lifeManagerErrorResponse(error);
  }
}
