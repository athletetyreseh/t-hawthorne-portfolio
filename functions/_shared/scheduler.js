export const MAX_STATE_BYTES = 1_000_000;
export const HISTORY_LIMIT = 30;
export const HISTORY_INTERVAL_MS = 5 * 60 * 1000;

// Shared response and persistence helpers keep every scheduler API route on
// the same validation, cache-control, and restore-retention rules.

export const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  }
});

export const requireSameOrigin = (request) => {
  const origin = request.headers.get("Origin");
  return origin === new URL(request.url).origin;
};

export const parseBody = async (request) => {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new Response(JSON.stringify({ error: "Content-Type must be application/json" }), {
      status: 415,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_STATE_BYTES + 20_000) {
    throw json({ error: "Request is too large" }, 413);
  }

  const text = await request.text();
  if (text.length > MAX_STATE_BYTES + 20_000) throw json({ error: "Request is too large" }, 413);
  try { return JSON.parse(text); }
  catch { throw json({ error: "Request contains invalid JSON" }, 400); }
};

export const serializeValidatedState = (state) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw json({ error: "Schedule state must be an object" }, 400);
  }
  if (!Array.isArray(state.rows) || !Array.isArray(state.staff)) {
    throw json({ error: "Schedule rows and staff are required" }, 400);
  }
  if (state.rows.length > 500 || state.staff.length > 1000) {
    throw json({ error: "Schedule exceeds supported limits" }, 400);
  }
  const serialized = JSON.stringify(state);
  if (serialized.length > MAX_STATE_BYTES) throw json({ error: "Schedule state is too large" }, 413);
  return serialized;
};

export const stateResponse = (row) => {
  if (!row) return json({ error: "No cloud schedule exists" }, 404);
  try {
    return json({
      state: JSON.parse(row.state_json),
      revision: row.revision,
      updatedAt: row.updated_at
    });
  } catch {
    return json({ error: "Stored schedule data is invalid" }, 500);
  }
};

export const pruneHistory = async (database, ownerEmail) => {
  await database.prepare(
    `DELETE FROM scheduler_history
     WHERE owner_email = ? AND id NOT IN (
       SELECT id FROM scheduler_history WHERE owner_email = ? ORDER BY id DESC LIMIT ?
     )`
  ).bind(ownerEmail, ownerEmail, HISTORY_LIMIT).run();
};

export const maybeCreateHistory = async (database, ownerEmail, currentRow, now) => {
  if (!currentRow) return;
  const latest = await database.prepare(
    "SELECT created_at FROM scheduler_history WHERE owner_email = ? ORDER BY id DESC LIMIT 1"
  ).bind(ownerEmail).first();
  const latestTime = latest?.created_at ? Date.parse(latest.created_at) : 0;
  if (latestTime && Date.now() - latestTime < HISTORY_INTERVAL_MS) return;

  await database.prepare(
    "INSERT INTO scheduler_history (owner_email, revision, state_json, created_at) VALUES (?, ?, ?, ?)"
  ).bind(ownerEmail, currentRow.revision, currentRow.state_json, now).run();

  await pruneHistory(database, ownerEmail);
};

export const createRestorePoint = async (database, ownerEmail, currentRow, now) => {
  if (!currentRow) return;
  await database.prepare(
    "INSERT INTO scheduler_history (owner_email, revision, state_json, created_at) VALUES (?, ?, ?, ?)"
  ).bind(ownerEmail, currentRow.revision, currentRow.state_json, now).run();
  await pruneHistory(database, ownerEmail);
};

// Both the browser sync endpoint and the command endpoint use this one write
// path. Keeping the compare-and-swap and restore-history behavior together is
// important: a direct automation command must not bypass normal cloud sync.
export const saveSchedulerState = async (database, ownerEmail, state, { baseRevision = null, force = false, historyAlways = false } = {}) => {
  const serialized = serializeValidatedState(state);
  const now = new Date().toISOString();
  const current = await database.prepare(
    "SELECT state_json, revision, updated_at FROM scheduler_state WHERE owner_email = ?"
  ).bind(ownerEmail).first();

  if (!current) {
    const result = await database.prepare(
      "INSERT OR IGNORE INTO scheduler_state (owner_email, state_json, revision, updated_at) VALUES (?, ?, 1, ?)"
    ).bind(ownerEmail, serialized, now).run();
    if (!result.meta?.changes) {
      const raced = await database.prepare(
        "SELECT revision, updated_at FROM scheduler_state WHERE owner_email = ?"
      ).bind(ownerEmail).first();
      return { conflict: true, revision: raced?.revision, updatedAt: raced?.updated_at };
    }
    return { revision: 1, updatedAt: now };
  }

  if (!force && (!Number.isSafeInteger(baseRevision) || baseRevision !== current.revision)) {
    return { conflict: true, revision: current.revision, updatedAt: current.updated_at };
  }

  const nextRevision = current.revision + 1;
  const result = await database.prepare(
    "UPDATE scheduler_state SET state_json = ?, revision = ?, updated_at = ? WHERE owner_email = ? AND revision = ?"
  ).bind(serialized, nextRevision, now, ownerEmail, current.revision).run();
  if (!result.meta?.changes) {
    const raced = await database.prepare(
      "SELECT revision, updated_at FROM scheduler_state WHERE owner_email = ?"
    ).bind(ownerEmail).first();
    return { conflict: true, revision: raced?.revision, updatedAt: raced?.updated_at };
  }

  if (historyAlways) await createRestorePoint(database, ownerEmail, current, now);
  else await maybeCreateHistory(database, ownerEmail, current, now);
  return { revision: nextRevision, updatedAt: now };
};

// Restore is shared by the normal UI and direct undo. It always snapshots the
// current state first, so a restore/undo is itself recoverable through the
// established history mechanism.
export const restoreSchedulerState = async (database, ownerEmail, versionId, { baseRevision = null } = {}) => {
  const version = await database.prepare(
    "SELECT state_json, revision, created_at FROM scheduler_history WHERE owner_email = ? AND id = ?"
  ).bind(ownerEmail, versionId).first();
  if (!version) return { notFound: true };
  const current = await database.prepare(
    "SELECT state_json, revision, updated_at FROM scheduler_state WHERE owner_email = ?"
  ).bind(ownerEmail).first();
  if (!current) return { noCurrent: true };
  if (baseRevision != null && (!Number.isSafeInteger(baseRevision) || baseRevision !== current.revision)) {
    return { conflict: true, revision: current.revision, updatedAt: current.updated_at };
  }

  const now = new Date().toISOString();
  await createRestorePoint(database, ownerEmail, current, now);
  const nextRevision = current.revision + 1;
  const result = await database.prepare(
    "UPDATE scheduler_state SET state_json = ?, revision = ?, updated_at = ? WHERE owner_email = ? AND revision = ?"
  ).bind(version.state_json, nextRevision, now, ownerEmail, current.revision).run();
  if (!result.meta?.changes) return { conflict: true, revision: current.revision, updatedAt: current.updated_at };
  return { state_json: version.state_json, revision: nextRevision, updated_at: now, restoredVersionId: versionId };
};

export const errorResponse = (error) => {
  if (error instanceof Response) return error;
  console.error("Scheduler API error", error);
  return json({ error: "Scheduler service failed" }, 500);
};
