# Scheduler agent PIN access

Entry: https://t-hawthorne.com/scheduler-agent/
Owner settings: https://t-hawthorne.com/tools/th-operations-scheduler/api/pin-access

The original Cloudflare route and middleware remain unchanged. The owner must set a six-digit code on the protected settings page before the new route can authenticate anyone. The code never enters GitHub or a frontend asset; D1 stores a random salt and PBKDF2-SHA256 hash (100,000 iterations).

The secondary route serves a minimal JSON console and exposes the shared schedule through direct APIs under a separate authenticated prefix. No human calendar, asset bundle, polling, or background autosave is loaded. It does not provide private-site administration or PIN administration. Agents can type a code or use the keypad, then use relative `api/capabilities`, `api/state`, and `api/commands` with the normal revision checks and command confirmation rules.

After the fifth failed attempt, the Cloudflare-supplied public IP is blocked from PIN login until the owner clears lockouts or rotates the PIN. D1 increments failures atomically, including concurrent failures. Failures do not reset on refresh, cookie removal, or a successful login. IPs are stored as salted hashes. An existing authenticated session remains valid until expiry, disable, or rotation. A browser cannot reliably provide an unchangeable device identifier; networks with a shared public IP share the lockout, and moving to a different public IP creates a different identity. This is per-IP brute-force protection, not protection against unlimited distributed IPs.

Sessions use 256-bit random tokens stored hashed in D1, last four hours, and are bound to the originating IP and PIN version. Cookies are Secure, HttpOnly, SameSite=Strict and scoped to /scheduler-agent/. Changing or disabling the PIN revokes all existing sessions. Mutations require the same Origin as the page. All protected responses are no-store.

If a Cloudflare Access application covers the whole hostname, create a narrowly scoped policy for /scheduler-agent/* while preserving the existing scheduler application. Do not bypass Access for the original scheduler or its settings. Verify unauthenticated GET /scheduler-agent/api/state returns 401 before enabling the PIN. Check Pages Functions fail-closed behavior; the second route has no static schedule copy to expose if Functions is unavailable.

Validation: `node --test tests/*.test.mjs` (Node 22+ with node:sqlite), and `npx wrangler pages functions build`. Local integration with Wrangler verified the login page, owner setup, accepted session, agent console, adapted capability manifest, and persistent fifth-attempt lockout. Do not exercise lockout on a production network without planning to clear it via owner settings.

## Fast agent workflow

1. Authenticate using the keypad or POST `/scheduler-agent/login` with JSON `{"pin":"<six digits>"}`. Retain the returned cookie; send the website Origin on writes.
2. GET `api/context` for the revision, stable row IDs, roster, and settings. It omits assignments.
3. GET `api/query?from=2026-09-14&to=2026-09-20&site=Cityscape&status=open` for filtered flat entries. Optional officer, rowId, mode, offset and limit filters reduce output. Read `nextOffset` until null.
4. POST `api/execute` with `{baseRevision, command, dryRun:true}` for an optional non-saving preview, or omit dryRun to persist. Use one batch of up to 50 operations. No nested batches.
5. Read the returned revision/results; successful mutations already saved. A 409 means reload and resolve the target again. Never automatically replay writes after network failures.

The authenticated `api/capabilities` endpoint includes `commandReference` with required and optional arguments for every command, endpoint paths, query parameters, and transport requirements. Existing `api/commands` remains available for writes; only `api/execute` supports dryRun. `api/command-history` and `api/command-undo` expose audit/undo. GET/PATCH `api/officer-admin` handles officer requests.

New operations: copy_cell, copy_week (working/master), update_row, remove_row, update_settings, replace_state. Assignment patches also include billCategory, hoursDesc, invoice. Full JSON import uses replace_state with explicit confirmation and baseRevision, validates structural limits, IDs, date keys, times and statuses, and creates a restore point. It can express remaining schedule adjustments, including creating the first row, moving rows, and updating retained metadata. Export the complete state first and preserve unrelated fields. It does not change private-site or PIN-administration permissions.

Copying over cells/weeks, removing rows, and replacing state require confirm:true. Blank/blocked status changes through set_status/update_assignment use the same confirmation check as clear/block. A batch confirmation applies to its items. Dry runs validate exactly the same rules as writes but create no revision or history entry.
