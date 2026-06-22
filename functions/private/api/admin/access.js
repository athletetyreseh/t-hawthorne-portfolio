import {
  RESOURCE_CATALOG,
  json,
  parseJson,
  privateErrorResponse,
  requireAdmin,
  requireSameOrigin
} from "../../../_shared/private-access.js";

const validLevel = (value) => value === "view" || value === "edit";

export async function onRequestGet(context) {
  try {
    const adminError = requireAdmin(context);
    if (adminError) return adminError;
    const [users, permissions] = await Promise.all([
      context.env.SCHEDULER_DB.prepare(
        "SELECT email, role, created_at, last_seen_at FROM private_users ORDER BY role DESC, email"
      ).all(),
      context.env.SCHEDULER_DB.prepare(
        "SELECT user_email, resource_key, access_level, granted_by, granted_at FROM private_permissions ORDER BY user_email, resource_key"
      ).all()
    ]);
    return json({ users: users.results || [], permissions: permissions.results || [], resources: RESOURCE_CATALOG });
  } catch (error) {
    return privateErrorResponse(error);
  }
}

export async function onRequestPost(context) {
  try {
    const adminError = requireAdmin(context);
    if (adminError) return adminError;
    if (!requireSameOrigin(context.request)) return json({ error: "Invalid request origin" }, 403);
    const body = await parseJson(context.request);
    const action = String(body.action || "");
    const adminEmail = context.data.privateUser.email;
    const now = new Date().toISOString();

    if (action === "set-permission") {
      const email = String(body.email || "").trim().toLowerCase();
      const resourceKey = String(body.resourceKey || "");
      const accessLevel = String(body.accessLevel || "none");
      if (!email || !RESOURCE_CATALOG[resourceKey]) return json({ error: "A valid user and resource are required" }, 400);
      const user = await context.env.SCHEDULER_DB.prepare("SELECT email, role FROM private_users WHERE email = ?").bind(email).first();
      if (!user) return json({ error: "User has not signed in yet" }, 404);
      if (user.role === "owner") return json({ error: "Owner permissions cannot be changed" }, 400);
      if (accessLevel === "none") {
        await context.env.SCHEDULER_DB.prepare(
          "DELETE FROM private_permissions WHERE user_email = ? AND resource_key = ?"
        ).bind(email, resourceKey).run();
      } else {
        if (!validLevel(accessLevel)) return json({ error: "Invalid access level" }, 400);
        await context.env.SCHEDULER_DB.prepare(
          `INSERT INTO private_permissions (user_email, resource_key, access_level, granted_by, granted_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_email, resource_key) DO UPDATE SET
             access_level = excluded.access_level,
             granted_by = excluded.granted_by,
             granted_at = excluded.granted_at`
        ).bind(email, resourceKey, accessLevel, adminEmail, now).run();
      }
      return json({ ok: true });
    }

    if (action === "resolve-request") {
      const requestId = Number(body.requestId);
      const decision = body.decision === "approved" ? "approved" : body.decision === "denied" ? "denied" : "";
      if (!Number.isInteger(requestId) || !decision) return json({ error: "A valid request decision is required" }, 400);
      const request = await context.env.SCHEDULER_DB.prepare(
        "SELECT id, user_email, resource_key, requested_level, status FROM access_requests WHERE id = ?"
      ).bind(requestId).first();
      if (!request || request.status !== "pending") return json({ error: "Pending request was not found" }, 404);
      if (decision === "approved") {
        await context.env.SCHEDULER_DB.prepare(
          `INSERT INTO private_permissions (user_email, resource_key, access_level, granted_by, granted_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_email, resource_key) DO UPDATE SET
             access_level = excluded.access_level,
             granted_by = excluded.granted_by,
             granted_at = excluded.granted_at`
        ).bind(request.user_email, request.resource_key, request.requested_level, adminEmail, now).run();
      }
      await context.env.SCHEDULER_DB.prepare(
        "UPDATE access_requests SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ? AND status = 'pending'"
      ).bind(decision, now, adminEmail, requestId).run();
      return json({ ok: true, decision });
    }

    return json({ error: "Unknown administrator action" }, 400);
  } catch (error) {
    return privateErrorResponse(error);
  }
}
