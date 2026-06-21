import { authenticateSchedulerRequest } from "../../_shared/auth.js";

export async function onRequest(context) {
  const authentication = await authenticateSchedulerRequest(context);
  if (authentication.response) return authentication.response;
  context.data.schedulerUser = authentication.email;
  return context.next();
}
