import { authenticateAccessRequest } from "../../_shared/auth.js";
import { ensurePrivateSchema, ensurePrivateUser, hasResourceAccess, ownerEmailFor } from "../../_shared/private-access.js";

const deniedResponse = (context) => {
  const destination = context.request.headers.get("Sec-Fetch-Dest");
  const acceptsHtml = (context.request.headers.get("Accept") || "").includes("text/html");
  if (destination === "document" || acceptsHtml) {
    return Response.redirect(new URL("/private/?request=scheduler", context.request.url), 302);
  }
  return new Response(JSON.stringify({ error: "Scheduler access has not been granted" }), {
    status: 403,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
};

export async function onRequest(context) {
  const pathname = new URL(context.request.url).pathname;
  if (
    pathname.startsWith("/tools/th-operations-scheduler/officers/") ||
    pathname.endsWith("/tools/th-operations-scheduler/officers") ||
    pathname.endsWith("/tools/th-operations-scheduler/api/officer-public")
  ) {
    await ensurePrivateSchema(context.env.SCHEDULER_DB);
    return context.next();
  }

  const authentication = await authenticateAccessRequest(context);
  if (authentication.response) return authentication.response;
  const ownerEmail = ownerEmailFor(context);
  await ensurePrivateSchema(context.env.SCHEDULER_DB);
  context.data.privateUser = await ensurePrivateUser(context.env.SCHEDULER_DB, authentication.email, ownerEmail);
  const allowed = await hasResourceAccess(context.env.SCHEDULER_DB, authentication.email, "scheduler", "edit", ownerEmail);
  if (!allowed) return deniedResponse(context);
  // Every permitted operator edits the same owner-controlled schedule.
  context.data.schedulerUser = ownerEmail;
  return context.next();
}
