import {
  authenticateLifeManagerDevice,
  lifeManagerErrorResponse,
  sha256Bytes
} from "../../../_shared/life-manager.js";
import { json } from "../../../_shared/private-access.js";

const photoIdFor = (context) => String(context.params.id || "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 160);

export async function onRequestGet(context) {
  try {
    const authentication = await authenticateLifeManagerDevice(context);
    if (authentication.response) return authentication.response;
    const ownerEmail = authentication.device.owner_email;
    const photoId = photoIdFor(context);
    const row = await context.env.SCHEDULER_DB.prepare(
      "SELECT * FROM life_manager_photos WHERE owner_email = ? AND photo_id = ? AND deleted_at IS NULL"
    ).bind(ownerEmail, photoId).first();
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

export async function onRequestPut(context) {
  try {
    const authentication = await authenticateLifeManagerDevice(context);
    if (authentication.response) return authentication.response;
    const ownerEmail = authentication.device.owner_email;
    const photoId = photoIdFor(context);
    if (!photoId) return json({ error: "Invalid photo id" }, 400);
    const contentType = String(context.request.headers.get("Content-Type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) return json({ error: "Only image uploads are accepted" }, 415);
    const bytes = await context.request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 15 * 1024 * 1024) return json({ error: "Photo must be between 1 byte and 15 MB" }, 413);
    const digest = await sha256Bytes(bytes);
    const objectKey = `${encodeURIComponent(ownerEmail)}/${photoId}`;
    await context.env.LIFE_MANAGER_PHOTOS.put(objectKey, bytes, {
      httpMetadata: { contentType },
      customMetadata: { sha256: digest }
    });
    const now = new Date().toISOString();
    const fileName = String(context.request.headers.get("X-File-Name") || "photo").slice(0, 180);
    await context.env.SCHEDULER_DB.prepare(
      `INSERT INTO life_manager_photos
        (owner_email, photo_id, object_key, file_name, content_type, byte_size, sha256, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(owner_email, photo_id) DO UPDATE SET
         object_key = excluded.object_key, file_name = excluded.file_name,
         content_type = excluded.content_type, byte_size = excluded.byte_size,
         sha256 = excluded.sha256, updated_at = excluded.updated_at, deleted_at = NULL`
    ).bind(ownerEmail, photoId, objectKey, fileName, contentType, bytes.byteLength, digest, now, now).run();
    return json({ photoId, sha256: digest, byteSize: bytes.byteLength, updatedAt: now });
  } catch (error) {
    return lifeManagerErrorResponse(error);
  }
}

export async function onRequestDelete(context) {
  try {
    const authentication = await authenticateLifeManagerDevice(context);
    if (authentication.response) return authentication.response;
    const ownerEmail = authentication.device.owner_email;
    const photoId = photoIdFor(context);
    const row = await context.env.SCHEDULER_DB.prepare(
      "SELECT object_key FROM life_manager_photos WHERE owner_email = ? AND photo_id = ?"
    ).bind(ownerEmail, photoId).first();
    if (!row) return new Response(null, { status: 204 });
    await context.env.LIFE_MANAGER_PHOTOS.delete(row.object_key);
    await context.env.SCHEDULER_DB.prepare(
      "UPDATE life_manager_photos SET deleted_at = ?, updated_at = ? WHERE owner_email = ? AND photo_id = ?"
    ).bind(new Date().toISOString(), new Date().toISOString(), ownerEmail, photoId).run();
    return new Response(null, { status: 204 });
  } catch (error) {
    return lifeManagerErrorResponse(error);
  }
}
