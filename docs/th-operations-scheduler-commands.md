# TH Operations Scheduler command API

`POST /tools/th-operations-scheduler/api/commands` is a narrow, authenticated command boundary for a voice or AI agent. It changes the same owner-controlled cloud schedule used by the private scheduler UI; it is not a public scheduling API.

## Access and synchronization

The endpoint is behind the existing scheduler authentication and edit permission middleware and requires a same-origin JSON request. Do not expose its session cookie or proxy it to an untrusted voice client. A trusted in-browser voice integration should first call `GET /tools/th-operations-scheduler/api/state`, retain its `revision`, and send that value as `baseRevision` with every mutating command. A stale revision returns `409` with `code: "revision_conflict"`; reload state and resolve the request again. Every successful mutation uses the normal cloud compare-and-swap save path and restore-history retention.

```json
{
  "baseRevision": 42,
  "command": {
    "kind": "assign",
    "target": { "site": "Cityscape", "post": "Lobby", "shift": "A", "date": "2026-08-03" },
    "officer": "Alex Morgan"
  }
}
```

The response is structured JSON with `ok`, `changed`, `revision`, `updatedAt`, and a compact `result`. Errors have `error`, a stable `code`, and (where safe) `details`. No state is returned from a mutation response, which keeps responses small and avoids exposing more schedule data than the authenticated caller requested.

## History and safe undo

`GET /tools/th-operations-scheduler/api/command-history` is the read-only history lookup for a trusted AI/voice agent. It returns `latestChange` plus up to 20 version intervals by default. Each interval provides a bounded list of field-level changes, such as assignment, time, officer, tag, note, roster, and row changes. Use `?limit=30` for the maximum list, `?versionId=123` to retrieve one interval, and `?versionId=123&includeState=true` only when the authenticated agent needs the complete private restore snapshot.

The latest interval compares the newest restore point to the current revision. `singleRevision: true` means that interval spans exactly one saved revision, so it answers “what was the last change?” directly. Otherwise the response accurately describes the changes since that restore point and the agent should state that it is a multi-revision interval. Direct command mutations add an immediate pre-change restore point, so their latest interval is normally a single revision.

`POST /tools/th-operations-scheduler/api/command-undo` safely restores the newest recoverable point using the same restore mechanism as the UI. It must include the revision last read and explicit confirmation:

```json
{ "baseRevision": 43, "confirm": true }
```

Undo creates a new restore point for the state it is replacing, so the operation remains recoverable through normal history. It returns `409` if the cloud revision has changed and never changes the UI directly.

## Target contract

Every cell command has a `target`:

```json
{ "rowId": "optional-stable-row-id", "site": "Cityscape", "post": "Lobby", "shift": "A", "date": "2026-08-03", "mode": "working" }
```

`date` is always required and must be `YYYY-MM-DD`. `mode` is `working` by default; use `master` to address the weekday slot for that date. Use either `rowId`, or both `site` and `post`. `shift` (`shiftCode` or `shiftName`) is strongly recommended and is required whenever site/post identify more than one row. `target.officer`, if supplied, means the current assigned officer and can further disambiguate an existing assignment; it is not the officer to assign.

Resolution is exact after whitespace/case normalization. Zero matches return `target_not_found` (404); multiple matches return `ambiguous_target` (409) with safe row identifiers. This deliberately prevents a natural-language request from guessing which post is meant.

## Commands

The small primitives cover the scheduler's existing cell edits and provide an extensible single execution point:

- `assign`: requires `officer`; optional `start`, `end`, `position`, `note`, and `allowNewOfficer: true`.
- `unassign`: changes the cell to an open gap while retaining its time.
- `set_time`: requires `start`, `end`, or both; values are 24-hour `HHMM` or `HH:MM`.
- `set_status`: `assigned`, `escort`, `open`, `blank`, `blocked`, `sick`, `pto`, or `training`; optionally supply `officer` for staff-bearing statuses.
- `set_note`, `tag`, and `untag`.
- `update_assignment`: an atomic patch for `status`, `officer`, `start`, `end`, `position`, `note`, and `tagged`.
- `clear` and `block` for the existing gray/diagonal cell behavior.
- `add_officer` and `remove_officer` for the saved roster. Removing a roster entry does not erase historic assignments.
- `set_row_post`, `insert_row`, `hide_row`, and `show_row` cover the row/post edits available in the scheduler. `insert_row` clones the selected row's shape into the selected working week or master view, but starts all cells blank.
- `rollover_master` and `clear_week` cover the scheduler-wide operations. Both require an explicit `confirm: true`; `clear_week` may be limited with `site`.
- `batch`: one to fifty commands are validated and applied to one in-memory copy, then saved as one revision.
- `save` / `sync`: authenticated acknowledgement commands; they do not create a redundant revision because mutations are already cloud-saved.

For a new officer, `assign` rejects an unknown name by default to catch speech-recognition mistakes. Set `allowNewOfficer: true` only when creating a roster entry is intentional. Blank and blocked cells reject time, note, and tag operations; use `assign`, `set_status`, or `update_assignment` first.

## Examples

```json
{ "baseRevision": 42, "command": { "kind": "set_time", "target": { "site": "Cityscape", "post": "Lobby", "shift": "A", "date": "2026-08-03" }, "start": "0630" } }
```

```json
{ "baseRevision": 43, "command": { "kind": "batch", "commands": [
  { "kind": "assign", "target": { "rowId": "city-lobby-a", "date": "2026-08-03" }, "officer": "Alex Morgan" },
  { "kind": "tag", "target": { "rowId": "city-lobby-a", "date": "2026-08-03" } },
  { "kind": "set_note", "target": { "rowId": "city-lobby-a", "date": "2026-08-03" }, "note": "Coverage change approved by supervisor." }
] } }
```

Run `npm run test:scheduler-commands` for local command-resolution and mutation verification.
