import { authenticateAccessRequest } from "../_shared/auth.js";
import { json } from "../_shared/private-access.js";
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
  if (!authentication.isOwner) return json({error: "Badge desk owner access is required"}, 403);
  return desk.fetch(context.request, context.env, true);
}
