import {
  applyRecordChange,
  ensureLifeManagerSchema,
  lifeManagerErrorResponse,
  parseLifeManagerJson,
  recordsSince
} from "../../../_shared/life-manager.js";
import { json, requireAdmin, requireSameOrigin } from "../../../_shared/private-access.js";

export async function onRequestGet(context) {
  try {
    const denied = requireAdmin(context);
    if (denied) return denied;
    await ensureLifeManagerSchema(context.env.SCHEDULER_DB);
    const ownerEmail = context.data.privateUser.email;
    const state = await recordsSince(context.env.SCHEDULER_DB, ownerEmail, 0);
    const photos = await context.env.SCHEDULER_DB.prepare(
      "SELECT photo_id, file_name, content_type, byte_size, sha256, updated_at FROM life_manager_photos WHERE owner_email = ? AND deleted_at IS NULL ORDER BY updated_at DESC"
    ).bind(ownerEmail).all();
    const history = await context.env.SCHEDULER_DB.prepare(
      `SELECT id, record_type, record_id, version, client_updated_at, outcome, archived_at, archived_by
       FROM life_manager_history WHERE owner_email = ? ORDER BY id DESC LIMIT 50`
    ).bind(ownerEmail).all();
    return json({ ...state, photos: photos.results || [], history: history.results || [] });
  } catch (error) {
    return lifeManagerErrorResponse(error);
  }
}

export async function onRequestPut(context) {
  try {
    const denied = requireAdmin(context);
    if (denied) return denied;
    if (!requireSameOrigin(context.request)) return json({ error: "Invalid request origin" }, 403);
    await ensureLifeManagerSchema(context.env.SCHEDULER_DB);
    const body = await parseLifeManagerJson(context.request);
    const ownerEmail = context.data.privateUser.email;
    const result = await applyRecordChange(
      context.env.SCHEDULER_DB,
      ownerEmail,
      body,
      `website:${ownerEmail}`
    );
    return json(result, result.accepted ? 200 : 409);
  } catch (error) {
    return lifeManagerErrorResponse(error);
  }
}

export async function onRequestDelete(context) {
  try {
    const denied = requireAdmin(context);
    if (denied) return denied;
    if (!requireSameOrigin(context.request)) return json({ error: "Invalid request origin" }, 403);
    await ensureLifeManagerSchema(context.env.SCHEDULER_DB);
    const body = await parseLifeManagerJson(context.request, 20_000);
    const result = await applyRecordChange(
      context.env.SCHEDULER_DB,
      context.data.privateUser.email,
      { ...body, payload: null, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      `website:${context.data.privateUser.email}`
    );
    return json(result, result.accepted ? 200 : 409);
  } catch (error) {
    return lifeManagerErrorResponse(error);
  }
}
