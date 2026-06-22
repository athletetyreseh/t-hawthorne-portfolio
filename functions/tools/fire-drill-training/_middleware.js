import { authenticateAccessRequest } from "../../_shared/auth.js";
import { ensurePrivateSchema, ensurePrivateUser, hasResourceAccess, ownerEmailFor } from "../../_shared/private-access.js";

const deniedResponse = (context) => {
  const destination = context.request.headers.get("Sec-Fetch-Dest");
  const acceptsHtml = (context.request.headers.get("Accept") || "").includes("text/html");
  if (destination === "document" || acceptsHtml) {
    return Response.redirect(new URL("/private/?request=fire_drill", context.request.url), 302);
  }
  return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
};

export async function onRequest(context) {
  const authentication = await authenticateAccessRequest(context);
  if (authentication.response) return authentication.response;
  const ownerEmail = ownerEmailFor(context);
  await ensurePrivateSchema(context.env.SCHEDULER_DB);
  context.data.privateUser = await ensurePrivateUser(context.env.SCHEDULER_DB, authentication.email, ownerEmail);
  const allowed = await hasResourceAccess(context.env.SCHEDULER_DB, authentication.email, "fire_drill", "view", ownerEmail);
  if (!allowed) return deniedResponse(context);
  return context.next();
}
