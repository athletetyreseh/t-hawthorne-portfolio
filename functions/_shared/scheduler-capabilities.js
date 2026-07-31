// Public contract metadata for the authenticated scheduler command surface.
// It intentionally contains no tenant, roster, row, or schedule information.
export const SCHEDULER_CAPABILITIES_VERSION = "2026-07-30";

export const getSchedulerCapabilityManifest = () => ({
  schemaVersion: SCHEDULER_CAPABILITIES_VERSION,
  product: "TH Operations Scheduler",
  description: "Machine-readable capability context for an authenticated scheduler operator or agent. This manifest never includes schedule data.",
  privacy: {
    scheduleDataIncluded: false,
    access: "The manifest and all scheduler endpoints require the existing authenticated scheduler edit permission. Mutations also require a same-origin JSON request."
  },
  agentExecutionRules: {
    codeFirst: "For precise routine work, call the direct command API. Use one batch command for multi-cell or multi-day work. Use the visual scheduler only when the command API is genuinely unavailable.",
    automaticTags: "Every successful mutating command automatically adds or retains a visible agent-change tag on each affected assignment or row. Results report agentTags, and history records the tagged field change. Do not add a separate tag command for routine agent work. An explicit untag inside a batch is supported for deliberate tag cleanup and is reported in agentTags.cleared.",
    confirmation: "Precise non-destructive edits (time, assignment, status, note, and normal tagging) need no confirmation. Ambiguous targets are rejected for clarification. Clearing, blocking, removing a roster entry, clearing a week, and rolling over require one explicit confirm: true; a batch-level confirm applies to its destructive items.",
    auditability: "Every direct mutation creates a pre-change restore point and is reversible through the normal history and confirmed undo path."
  },
  endpoints: {
    manifest: { method: "GET", path: "/tools/th-operations-scheduler/api/capabilities" },
    state: { method: "GET", path: "/tools/th-operations-scheduler/api/state", description: "Private state and current revision; read this before any mutation." },
    commands: { method: "POST", path: "/tools/th-operations-scheduler/api/commands" },
    history: { method: "GET", path: "/tools/th-operations-scheduler/api/command-history", description: "Read-only, bounded change summaries. A full snapshot requires versionId and includeState=true." },
    undo: { method: "POST", path: "/tools/th-operations-scheduler/api/command-undo" }
  },
  target: {
    required: ["date", "rowId OR (site AND post)"],
    fields: {
      rowId: "Stable row identifier; preferred whenever known.",
      site: "Exact site name.",
      post: "Exact post name.",
      shift: "Shift code or shift name; required when the site and post are not unique.",
      date: "Required ISO date: YYYY-MM-DD.",
      mode: "working (default) or master.",
      officer: "Existing assigned officer only; use the top-level officer field to assign someone."
    }
  },
  operations: {
    assignments: ["assign", "unassign", "update_assignment"],
    time: ["set_time"],
    statuses: { commands: ["set_status", "clear", "block"], allowed: ["assigned", "escort", "open", "blank", "blocked", "sick", "pto", "training"] },
    tagsAndNotes: ["tag", "untag", "set_note"],
    roster: ["add_officer", "remove_officer"],
    rows: ["set_row_post", "insert_row", "hide_row", "show_row"],
    batch: { kind: "batch", maximumCommands: 50, behavior: "Validated, auto-tagged, and saved as one auditable revision. Prefer this for multi-cell or multi-day work." },
    tagCleanup: { use: "batch", behavior: "To keep only selected existing tags, include one untag command for each tag to clear. Explicit untag is the deliberate exception to auto-tagging and is reported in agentTags.cleared." },
    history: "Use the history endpoint to look up bounded field-level changes.",
    acknowledgements: ["save", "sync"]
  },
  safety: {
    deterministicResolution: "Targets normalize whitespace and case, then resolve exactly. Multiple matches return ambiguous_target with safe row identifiers; zero matches return target_not_found. Do not guess.",
    concurrency: "Every mutating command requires the current state revision as baseRevision. A stale revision returns revision_conflict (409); reload state and resolve again.",
    confirmations: ["clear, block, remove_officer, clear_week, and rollover_master require command.confirm: true", "A batch command may carry one confirm: true for all destructive items inside it", "undo requires confirm: true and the current baseRevision"],
    destructiveOperations: ["clear", "block", "remove_officer", "clear_week", "rollover_master", "command-undo"],
    routineEdits: "assign, unassign, set_time, set_status, set_note, update_assignment, tag, and untag do not require confirmation when their target is exact.",
    recoverability: "Direct mutations create a pre-change restore point. Undo and restore operations create another recoverable revision, and agentTags identify the affected entries or rows.",
    rosterGuard: "Unknown officers are rejected unless allowNewOfficer: true is explicitly supplied."
  },
  requestSchema: {
    type: "object",
    required: ["command"],
    properties: {
      baseRevision: { type: "integer", minimum: 1, description: "Required for mutations; obtain from GET state." },
      command: {
        type: "object",
        required: ["kind"],
        properties: {
          kind: { type: "string", enum: ["assign", "unassign", "set_time", "set_status", "set_note", "tag", "untag", "update_assignment", "clear", "block", "add_officer", "remove_officer", "set_row_post", "insert_row", "hide_row", "show_row", "rollover_master", "clear_week", "batch", "save", "sync"] },
          target: { type: "object", description: "Required for cell and row operations; see target contract." },
          confirm: { type: "boolean", description: "Required once for destructive operations; batch-level confirmation applies to destructive child commands." }
        }
      }
    }
  },
  examples: [
    {
      label: "Assign an officer and set a note (automatically tagged)",
      request: {
        baseRevision: 42,
        command: {
          kind: "update_assignment",
          target: { rowId: "city-lobby-a", date: "2026-08-03", mode: "working" },
          patch: { status: "assigned", officer: "Alex Morgan", start: "0630", end: "1430", note: "Coverage approved by supervisor." }
        }
      }
    },
    {
      label: "Apply one multi-day batch (each changed entry is automatically tagged)",
      request: {
        baseRevision: 43,
        command: {
          kind: "batch",
          commands: [
            { kind: "set_status", target: { rowId: "city-lobby-a", date: "2026-08-03" }, status: "sick", officer: "Alex Morgan" },
            { kind: "set_note", target: { rowId: "city-lobby-a", date: "2026-08-03" }, note: "Reported sick; coverage needed." }
          ]
        }
      }
    }
  ]
});
