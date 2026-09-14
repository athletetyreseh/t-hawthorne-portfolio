# Browser autosave

The save-conflict dialog loop came from calling normal pending-save recovery when
“Load cloud version” was clicked. That recovery reopened the same dialog. Failed
uploads could also leave the dialog in place, which suppressed retries; stalled
requests held the save lock, and the focus/active-tab gate skipped background saves.

The browser now keeps the last acknowledged cloud state as a merge baseline.
A 409 fetches the latest state, merges unsent local edits, then retries using that
revision. Rows merge by ID; separate assignment dates and master days merge
independently. Concurrent edits to the same assignment use the complete local
assignment, avoiding a hybrid guard/time/status. Local deletions win over concurrent
edits; remote deletions of untouched values remain deleted. Simple string lists
(such as staff) preserve independent additions/removals. Other unkeyed arrays use
the local array when both copies change.

Normal saves retain the server's compare-and-swap check. They never force an upload
as an automatic conflict resolution. The existing explicit force upload/import and
history restore controls remain available. A racing explicit force upload falls
back to normal reconciliation and revision-checked retry.

The pending journal includes the unsent snapshot and baseline in session storage,
with a local-storage recovery copy. Successful saves only clear matching journals;
edits during a request remain pending against its new acknowledged revision.
Legacy journals have no baseline: recovery combines existing rows and cloud-only
rows, preferring the pending device's values where intent cannot be inferred. This
one-time migration cannot distinguish old edits from stale values as precisely as
the new baseline-backed journal. Existing server restore history remains available.

State requests time out after 15 seconds. Failed uploads retry after 1.5 seconds
while online, including when another cloud panel is open or the tab is unfocused.
Local recovery remains necessary when connectivity or authentication is unavailable;
a cloud save cannot be guaranteed while the browser is closed or disconnected.

UI changes are limited to save status, keyboard focus outlines, rounded controls,
subtle hover/shadow treatments and scrollbars. Grid layout and schedule status/week
colors retain their existing behavior.

Validation: `node --test tests/*.test.mjs`. Browser preview uses a local demo API;
no production assignments are modified for testing.
