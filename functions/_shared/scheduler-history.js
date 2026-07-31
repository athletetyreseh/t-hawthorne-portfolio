// Read-only summaries for private scheduler restore points. The scheduler
// stores complete state snapshots, so diffs are derived at read time instead
// of keeping a second, potentially divergent mutation model.

const assignmentView = (assignment = {}) => ({
  status: assignment.status || "blank",
  officer: assignment.name || "",
  position: assignment.position || "",
  start: assignment.start || "",
  end: assignment.end || "",
  tagged: assignment.tagged === true,
  note: assignment.note || ""
});
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const rowKey = (row) => String(row?.id || "");
const targetFor = (row, key, mode) => ({
  rowId: row.id,
  site: row.site || "",
  post: row.post || "",
  shift: row.shiftCode || row.shiftName || "",
  key,
  mode
});

export const parseSchedulerSnapshot = (serialized) => {
  try {
    const state = JSON.parse(serialized);
    if (!state || !Array.isArray(state.rows)) throw new Error("Invalid state");
    return state;
  } catch {
    throw new Error("Stored schedule data is invalid");
  }
};

// Bounded summaries keep a voice agent's answer useful without returning an
// entire private schedule in every history list response.
export const summarizeSchedulerChanges = (before, after, maxChanges = 100) => {
  const changes = [];
  let total = 0;
  const add = (change) => {
    total += 1;
    if (changes.length < maxChanges) changes.push(change);
  };
  const beforeRows = new Map((before?.rows || []).map((row) => [rowKey(row), row]));
  const afterRows = new Map((after?.rows || []).map((row) => [rowKey(row), row]));
  const ids = new Set([...beforeRows.keys(), ...afterRows.keys()]);

  for (const id of ids) {
    const left = beforeRows.get(id);
    const right = afterRows.get(id);
    if (!left || !right) {
      const row = right || left;
      add({ type: left ? "row_removed" : "row_added", target: targetFor(row, "", "row") });
      continue;
    }
    const beforeRow = { site: left.site || "", post: left.post || "", shift: left.shiftCode || left.shiftName || "", hiddenWeeks: left.hiddenWeeks || [], masterHidden: left.masterHidden === true };
    const afterRow = { site: right.site || "", post: right.post || "", shift: right.shiftCode || right.shiftName || "", hiddenWeeks: right.hiddenWeeks || [], masterHidden: right.masterHidden === true };
    if (!same(beforeRow, afterRow)) add({ type: "row_updated", target: targetFor(right, "", "row"), before: beforeRow, after: afterRow });
    for (const mode of ["working", "master"]) {
      const leftAssignments = mode === "working" ? left.assignments || {} : left.master || {};
      const rightAssignments = mode === "working" ? right.assignments || {} : right.master || {};
      const keys = new Set([...Object.keys(leftAssignments), ...Object.keys(rightAssignments)]);
      for (const assignmentKey of keys) {
        const beforeAssignment = assignmentView(leftAssignments[assignmentKey]);
        const afterAssignment = assignmentView(rightAssignments[assignmentKey]);
        if (!same(beforeAssignment, afterAssignment)) {
          add({
            type: "assignment_updated",
            target: targetFor(right, assignmentKey, mode),
            before: beforeAssignment,
            after: afterAssignment
          });
        }
      }
    }
  }
  const beforeStaff = [...new Set((before?.staff || []).map(String))].sort();
  const afterStaff = [...new Set((after?.staff || []).map(String))].sort();
  if (!same(beforeStaff, afterStaff)) add({ type: "roster_updated", before: beforeStaff, after: afterStaff });
  return { changes, totalChanges: total, truncated: total > changes.length };
};

export const historyEvents = (current, versions, maxChanges = 100) => {
  const snapshots = versions.map((version) => ({ ...version, state: parseSchedulerSnapshot(version.state_json) }));
  return snapshots.map((version, index) => {
    const newer = index === 0 ? current : snapshots[index - 1];
    const summary = summarizeSchedulerChanges(version.state, newer.state, maxChanges);
    return {
      id: version.id,
      fromRevision: version.revision,
      toRevision: newer.revision,
      createdAt: version.created_at,
      singleRevision: Number(newer.revision) === Number(version.revision) + 1,
      ...summary
    };
  });
};
