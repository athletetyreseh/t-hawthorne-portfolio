# Scheduler agent PIN access

Entry: https://t-hawthorne.com/scheduler-agent/
Owner settings: https://t-hawthorne.com/tools/th-operations-scheduler/api/pin-access

The original Cloudflare route and middleware remain unchanged. The owner must set a six-digit code on the protected settings page before the new route can authenticate anyone. The code never enters GitHub or a frontend asset; D1 stores a random salt and PBKDF2-SHA256 hash (100,000 iterations).

The secondary route serves the existing scheduler and calls the existing state, history, restore, command, and officer-request APIs under a separate authenticated prefix. It does not provide private-site administration or PIN administration. Agents can type a code or use the keypad, then use relative `api/capabilities`, `api/state`, and `api/commands` with the normal revision checks and command confirmation rules.

After the fifth failed attempt, the Cloudflare-supplied public IP is blocked from PIN login until the owner clears lockouts or rotates the PIN. D1 increments failures atomically, including concurrent failures. Failures do not reset on refresh, cookie removal, or a successful login. IPs are stored as salted hashes. An existing authenticated session remains valid until expiry, disable, or rotation. A browser cannot reliably provide an unchangeable device identifier; networks with a shared public IP share the lockout, and moving to a different public IP creates a different identity. This is per-IP brute-force protection, not protection against unlimited distributed IPs.

Sessions use 256-bit random tokens stored hashed in D1, last four hours, and are bound to the originating IP and PIN version. Cookies are Secure, HttpOnly, SameSite=Strict and scoped to /scheduler-agent/. Changing or disabling the PIN revokes all existing sessions. Mutations require the same Origin as the page. All protected responses are no-store.

If a Cloudflare Access application covers the whole hostname, create a narrowly scoped policy for /scheduler-agent/* while preserving the existing scheduler application. Do not bypass Access for the original scheduler or its settings. Verify unauthenticated GET /scheduler-agent/api/state returns 401 before enabling the PIN. Check Pages Functions fail-closed behavior; the second route has no static schedule copy to expose if Functions is unavailable.

Validation: `node --test tests/*.test.mjs` (Node 22+ with node:sqlite), and `npx wrangler pages functions build`. Local integration with Wrangler verified the login page, owner setup, accepted session, scheduler HTML, adapted capability manifest, and persistent fifth-attempt lockout. Do not exercise lockout on a production network without planning to clear it via owner settings.
