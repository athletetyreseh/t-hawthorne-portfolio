const badges = config.groups.flatMap(group => Array.from({length: group.count}, (_, i) => {
  const code = group.prefix + "-" + String(i + 1).padStart(2, "0");
  return {code, slug: code.toLowerCase(), number: i + 1, group: group.name, theme: group.theme, logos: group.logos};
}));
const bySlug = new Map(badges.map(badge => [badge.slug, badge]));
const idPattern = /^[a-f0-9-]{36}$/;
const headers = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'"
};
const json = (body, status = 200) => Response.json(body, {status, headers});
const error = (message, status) => json({error: message}, status);
const send = (body, type, status = 200) => new Response(body, {status, headers: {...headers, "content-type": type}});
// A photo expires 72 hours after checkout even if background cleanup is delayed.
const select = "SELECT id, badge, first_name, last_name, phone, CASE WHEN photo_key IS NOT NULL AND julianday(checked_out_at) > julianday('now', '-3 days') THEN 1 ELSE 0 END AS has_photo, checked_out_at, returned_at, owner FROM checkouts";

async function boundedBody(request, limit) {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
}

async function getForm(request, limit = 2_100_000) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().startsWith("multipart/form-data;") || !request.body) return null;
  const body = await boundedBody(request, limit);
  if (body === null) return null;
  return new Response(body, {headers: {"content-type": type}}).formData().catch(() => null);
}

// The edge supplies CF-Connecting-IP. Persist only its hash, never the IP itself.
// A single atomic statement applies the limit across isolates and concurrent requests.
async function publicWriteAllowed(request, env) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return null;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip)));
  const key = Array.from(hash, b => b.toString(16).padStart(2, "0")).join("");
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(`INSERT INTO badge_rate_limits (client_hash, window_start, attempts)
    VALUES (?, ?, 1) ON CONFLICT(client_hash) DO UPDATE SET
    attempts = CASE WHEN window_start <= ? THEN 1 ELSE attempts + 1 END,
    window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END
    RETURNING attempts`).bind(key, now, now - 300, now - 300).first();
  return row.attempts <= 40;
}

async function checkout(request, env, badge) {
  const form = await getForm(request);
  if (!form) return error("The submission could not be read. Use an ID photo under 2 MB.", 400);
  const field = name => typeof form.get(name) === "string" ? form.get(name).trim() : "";
  if (field("id_collateral") !== "yes") return error("Confirm that you took possession of the ID as collateral.", 400);
  const first = field("first_name"), last = field("last_name"), phone = field("phone");
  const digits = phone.replace(/\D/g, "");
  if (!first || first.length > 80 || !last || last.length > 80 || !/^\+?[\d ().-]+$/.test(phone) ||
      phone.length > 32 || digits.length < 7 || digits.length > 15) {
    return error("Enter a first name, last name, and valid phone number.", 400);
  }
  const id = crypto.randomUUID();
  const photo = form.get("photo");
  let photoKey = null;
  if (photo !== null && (!(photo instanceof File) || photo.size > 2_000_000)) return error("Use an ID photo under 2 MB.", 400);
  if (photo?.size) {
    const bytes = new Uint8Array(await photo.arrayBuffer());
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 ||
        bytes.at(-2) !== 255 || bytes.at(-1) !== 217) return error("Choose a readable JPEG image.", 400);
    photoKey = id + ".jpg";
    await env.BUCKET.put(photoKey, bytes, {httpMetadata: {contentType: "image/jpeg"}});
  }
  let saved;
  try {
    saved = await env.DB.prepare(
      "INSERT INTO checkouts (id,badge,first_name,last_name,phone,photo_key,checked_out_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(badge) WHERE returned_at IS NULL DO NOTHING"
    ).bind(id, badge.slug, first, last, phone, photoKey, new Date().toISOString()).run();
  } catch (cause) {
    // A failed response can still mean the insert committed. Never delete its photo
    // on an uncertain error; reconcile by the unique ID if D1 is reachable.
    try {
      const row = await env.DB.prepare("SELECT id FROM checkouts WHERE id=?").bind(id).first();
      if (row) return json({badge: badge.code}, 201);
    } catch { /* Leave the photo for a later orphan reconciliation. */ }
    throw cause;
  }
  if (!saved.meta.changes) {
    // This insert definitely did not happen, so its uniquely named photo is safe to remove.
    if (photoKey) {
      try { await env.BUCKET.delete(photoKey); }
      catch { console.error("Unable to remove a rejected checkout photo"); }
    }
    return error("This badge is already checked out. Refresh to see the active checkout.", 409);
  }
  return json({badge: badge.code}, 201);
}

async function api(request, env, path, authorized) {
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) {
    return error("This request must come from the badge desk.", 403);
  }
  if (!authorized && (path === "/api/history" || path === "/api/history.xlsx" || path.startsWith("/api/record/"))) {
    return error("Staff authorization is required.", 401);
  }
  if (request.method === "GET" && path === "/api/status") {
    const {results} = await env.DB.prepare("SELECT badge FROM checkouts WHERE returned_at IS NULL").all();
    return json(results.map(row => row.badge).filter(slug => bySlug.has(slug)));
  }
  if (request.method === "GET" && path === "/api/history") {
    const {results} = await env.DB.prepare(select + " ORDER BY checked_out_at DESC LIMIT 100").all();
    return json(results);
  }
  if (request.method === "GET" && path === "/api/history.xlsx") {
    const workbook = await activityWorkbook(env.DB);
    return new Response(workbook, {headers: {...headers, "content-type": workbookMime,
      "content-disposition": 'attachment; filename="badge-activity-log.xlsx"'}});
  }
  const card = path.match(/^\/api\/badge\/([a-z0-9-]+)(\/return)?$/);
  if (card && bySlug.has(card[1])) {
    const badge = bySlug.get(card[1]);
    if (!card[2] && request.method === "GET") {
      const record = await env.DB.prepare("SELECT 1 AS occupied FROM checkouts WHERE badge=? AND returned_at IS NULL").bind(badge.slug).first();
      return json(record ? {occupied: true} : null);
    }
    if (request.method === "POST") {
      const allowed = await publicWriteAllowed(request, env);
      if (allowed === null) return error("Badge service is temporarily unavailable.", 503);
      if (!allowed) return error("Too many requests. Please wait a few minutes and try again.", 429);
      if (!card[2]) return checkout(request, env, badge);
      if (await boundedBody(request, 1024) === null) return error("Request is too large.", 413);
      const row = await env.DB.prepare("UPDATE checkouts SET returned_at=? WHERE badge=? AND returned_at IS NULL")
        .bind(new Date().toISOString(), badge.slug).run();
      return row.meta.changes ? json({returned: true}) : error("This badge is already available.", 409);
    }
  }
  const record = path.match(/^\/api\/record\/([a-f0-9-]+)\/(return|photo|owner)$/);
  if (record && idPattern.test(record[1])) {
    const [, id, action] = record;
    if (action === "return" && request.method === "POST") {
      if (await boundedBody(request, 1024) === null) return error("Request is too large.", 413);
      const row = await env.DB.prepare("UPDATE checkouts SET returned_at=? WHERE id=? AND returned_at IS NULL")
        .bind(new Date().toISOString(), id).run();
      return row.meta.changes ? json({returned: true}) : error("This checkout is already closed or no longer exists.", 409);
    }
    if (action === "owner" && request.method === "POST") {
      const form = await getForm(request, 4096);
      const value = form?.get("owner");
      if (typeof value !== "string" || value.trim().length > 80) return error("Use up to 80 characters for the owner.", 400);
      const owner = value.trim() || null;
      const saved = await env.DB.prepare("UPDATE checkouts SET owner=? WHERE id=?").bind(owner,id).run();
      return saved.meta.changes ? json({owner}) : error("This checkout no longer exists.", 404);
    }
    if (action === "photo" && request.method === "GET") {
      const row = await env.DB.prepare("SELECT photo_key, checked_out_at FROM checkouts WHERE id=?").bind(id).first();
      const uploadedAt = Date.parse(row?.checked_out_at || "");
      if (!Number.isFinite(uploadedAt) || Date.now() - uploadedAt >= 72 * 60 * 60 * 1000) {
        return error("No photo for this checkout.", 404);
      }
      const file = row?.photo_key ? await env.BUCKET.get(row.photo_key) : null;
      return file ? send(file.body, "image/jpeg") : error("No photo for this checkout.", 404);
    }
  }
  return error("That page could not be found.", 404);
}

export default {
  // authorized is supplied only by the Pages Function after verifying Cloudflare Access.
  async fetch(request, env, authorized = false) {
    const url = new URL(request.url);
    try {
      if (url.pathname !== "/badges" && !url.pathname.startsWith("/badges/")) return error("Page not found.", 404);
      const path = url.pathname.slice("/badges".length).replace(/\/$/, "") || "/";
      if (path.startsWith("/api/")) return await api(request, env, path, authorized);
      if (request.method !== "GET") return error("Method not allowed.", 405);
      if (path === "/history" && !authorized) return error("Staff authorization is required.", 401);
      if (path === "/catalog.json") return json({badges, origin: config.origin});
      const page = ["/", "/sheets", "/history"].includes(path) || path.startsWith("/b/");
      if (path === "/activity-log.xlsx") return error("That page could not be found.", 404);
      const asset = assets[page ? "/index.html" : path];
      return asset ? send(Uint8Array.from(atob(asset[1]), char => char.charCodeAt(0)), asset[0]) :
        send("Page not found", "text/plain; charset=utf-8", 404);
    } catch (cause) {
      console.error("Badge Desk request failed", cause instanceof Error ? cause.name : "Unknown error");
      return error("The badge desk could not complete this request. Check the badge status before trying again.", 503);
    }
  }
};
