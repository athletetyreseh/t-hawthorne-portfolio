const keyCache = new Map();

// Pages Functions do not include a JWT library, so Access tokens are verified
// directly against Cloudflare's published signing keys before any data is read.

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  }
});

const base64UrlBytes = (value) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const decodePart = (value) => JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));

const normalizeTeamDomain = (value) => {
  const text = String(value || "").trim().replace(/\/$/, "");
  if (!text) return "";
  return text.startsWith("https://") ? text : `https://${text}`;
};

const getVerificationKey = async (teamDomain, keyId) => {
  const cacheKey = `${teamDomain}:${keyId}`;
  const cached = keyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.key;

  const response = await fetch(`${teamDomain}/cdn-cgi/access/certs`, {
    headers: { Accept: "application/json" },
    cf: { cacheTtl: 3600, cacheEverything: true }
  });
  if (!response.ok) throw new Error("Cloudflare Access signing keys are unavailable");

  const payload = await response.json();
  const jwk = payload.keys?.find((candidate) => candidate.kid === keyId);
  if (!jwk) throw new Error("Cloudflare Access signing key was not found");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  keyCache.set(cacheKey, { key, expiresAt: Date.now() + 60 * 60 * 1000 });
  return key;
};

export const authenticateAccessRequest = async (context) => {
  const ownerEmail = String(context.env.OWNER_EMAIL || "").trim().toLowerCase();

  if (context.env.SCHEDULER_DEV_BYPASS === "true") {
    const email = String(context.env.PRIVATE_DEV_EMAIL || ownerEmail || "athletetyreseh@gmail.com").trim().toLowerCase();
    return { email, isOwner: email === ownerEmail };
  }

  const teamDomain = normalizeTeamDomain(context.env.CF_ACCESS_TEAM_DOMAIN);
  const audiences = String(context.env.CF_ACCESS_AUD || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!teamDomain || !audiences.length || !ownerEmail) {
    return { response: json({ error: "Private access is not configured" }, 503) };
  }

  const token = context.request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return { response: json({ error: "Authentication required" }, 401) };

  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Malformed access token");
    const header = decodePart(parts[0]);
    const claims = decodePart(parts[1]);
    if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported access token");

    const key = await getVerificationKey(teamDomain, header.kid);
    const validSignature = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64UrlBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    if (!validSignature) throw new Error("Invalid access token signature");

    const now = Math.floor(Date.now() / 1000);
    const tokenAudience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== teamDomain) throw new Error("Invalid token issuer");
    if (!audiences.some((audience) => tokenAudience.includes(audience))) throw new Error("Invalid token audience");
    if (!claims.exp || claims.exp < now - 30) throw new Error("Expired access token");
    if (claims.nbf && claims.nbf > now + 30) throw new Error("Access token is not active");

    const email = String(claims.email || "").trim().toLowerCase();
    if (!email) throw new Error("Access token has no email identity");
    return { email, isOwner: email === ownerEmail, claims };
  } catch (error) {
    console.error("Private access authentication failed", error);
    return { response: json({ error: "Invalid authentication" }, 403) };
  }
};

export const authenticateSchedulerRequest = authenticateAccessRequest;
