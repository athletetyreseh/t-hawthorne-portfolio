import { authenticateAccessRequest } from "../_shared/auth.js";
import { getAccessLevel, json, ownerEmailFor } from "../_shared/private-access.js";
import desk from "../_shared/badge-desk.generated.js";

export async function onRequest(context) {
  const path = new URL(context.request.url).pathname.replace(/\/$/, "");
  const isPrivate = path === "/badges/history" || path === "/badges/api/history" ||
    path === "/badges/api/history.xlsx" || path.startsWith("/badges/api/record/");
  if (!isPrivate) return desk.fetch(context.request, context.env, false);

  // Never allow the existing scheduler's development bypass to grant badge access.
  const authContext = {...context, env: {...context.env, SCHEDULER_DEV_BYPASS: "false"}};
  const authentication = await authenticateAccessRequest(authContext);
  if (authentication.response) return authentication.response;
  if (!authentication.isOwner) {
    try {
      const level = await getAccessLevel(context.env.SCHEDULER_DB, authentication.email, "badge_desk", ownerEmailFor(context));
      const needsEdit = context.request.method !== "GET" && context.request.method !== "HEAD";
      if (level !== "edit" && (needsEdit || level !== "view")) {
        return json({error: "Badge desk access has not been granted"}, 403);
      }
    } catch {
      return json({error: "Private access is not available"}, 503);
    }
  }
  return desk.fetch(context.request, context.env, true);
}
