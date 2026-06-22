import { json, ownerEmailFor, privateErrorResponse, requireResourceAccess, requireSameOrigin } from "../../_shared/private-access.js";

const assignmentNames = (row) => [
  ...Object.values(row.assignments || {}),
  ...Object.values(row.master || {})
].filter((assignment) => assignment && assignment.name).map((assignment) => ({
  name: String(assignment.name).trim(),
  roleTitle: String(assignment.position || row.post || "Security Officer").trim(),
  site: String(row.site || "").trim()
}));

export async function onRequestPost(context) {
  try {
    const access = await requireResourceAccess(context, "staff", "edit");
    if (access.response) return access.response;
    if (!requireSameOrigin(context.request)) return json({ error: "Invalid request origin" }, 403);
    const schedule = await context.env.SCHEDULER_DB.prepare(
      "SELECT state_json FROM scheduler_state WHERE owner_email = ?"
    ).bind(ownerEmailFor(context)).first();
    if (!schedule) return json({ error: "The master schedule has not been saved to the cloud yet" }, 404);
    let state;
    try { state = JSON.parse(schedule.state_json); }
    catch { return json({ error: "The stored master schedule is invalid" }, 500); }

    const candidates = new Map();
    (state.staff || []).forEach((name) => {
      const fullName = String(name || "").trim();
      if (fullName) candidates.set(fullName.toLowerCase(), { name: fullName, roleTitle: "Security Officer", site: "" });
    });
    (state.rows || []).flatMap(assignmentNames).forEach((candidate) => {
      const key = candidate.name.toLowerCase();
      const current = candidates.get(key);
      candidates.set(key, {
        name: candidate.name,
        roleTitle: current?.roleTitle && current.roleTitle !== "Security Officer" ? current.roleTitle : candidate.roleTitle,
        site: current?.site || candidate.site
      });
    });

    const existing = await context.env.SCHEDULER_DB.prepare("SELECT full_name FROM staff_records").all();
    const existingNames = new Set((existing.results || []).map((row) => row.full_name.toLowerCase()));
    const additions = [...candidates.entries()].filter(([key]) => !existingNames.has(key)).map(([, value]) => value);
    if (!additions.length) return json({ added: 0, totalFound: candidates.size });
    const now = new Date().toISOString();
    const actor = context.data.privateUser.email;
    await context.env.SCHEDULER_DB.batch(additions.map((candidate) => context.env.SCHEDULER_DB.prepare(
      `INSERT INTO staff_records
       (full_name, role_title, site, email, phone, guard_card_expiration, cpr_expiration, status, notes, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, '', '', '', '', 'active', '', ?, ?, ?, ?)`
    ).bind(candidate.name, candidate.roleTitle, candidate.site, now, actor, now, actor)));
    return json({ added: additions.length, totalFound: candidates.size });
  } catch (error) {
    return privateErrorResponse(error);
  }
}
