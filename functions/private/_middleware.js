import { authenticateAccessRequest } from "../_shared/auth.js";
import { ensurePrivateSchema, ensurePrivateUser, hasResourceAccess, ownerEmailFor } from "../_shared/private-access.js";

const denyPage = (context, resourceKey = "") => {
  const destination = context.request.headers.get("Sec-Fetch-Dest");
  const acceptsHtml = (context.request.headers.get("Accept") || "").includes("text/html");
  if (destination === "document" || acceptsHtml) {
    const suffix = resourceKey ? `?request=${encodeURIComponent(resourceKey)}` : "";
    return Response.redirect(new URL(`/private/${suffix}`, context.request.url), 302);
  }
  return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
};

export async function onRequest(context) {
  const authentication = await authenticateAccessRequest(context);
  if (authentication.response) return authentication.response;
  await ensurePrivateSchema(context.env.SCHEDULER_DB);
  context.data.privateUser = await ensurePrivateUser(
    context.env.SCHEDULER_DB,
    authentication.email,
    ownerEmailFor(context)
  );
  const pathname = new URL(context.request.url).pathname;
  if ((pathname === "/private/admin" || pathname.startsWith("/private/admin/")) && !context.data.privateUser.isAdmin) return denyPage(context);
  if (pathname === "/private/staff" || pathname.startsWith("/private/staff/")) {
    const allowed = await hasResourceAccess(
      context.env.SCHEDULER_DB,
      authentication.email,
      "staff",
      "view",
      ownerEmailFor(context)
    );
    if (!allowed) return denyPage(context, "staff");
  }
  return context.next();
}
