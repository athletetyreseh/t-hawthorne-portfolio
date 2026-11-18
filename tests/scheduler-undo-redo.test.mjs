import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function makeHistoryHarness() {
  const html = await readFile(new URL("../portfolio-site/tools/th-operations-scheduler/index.html", import.meta.url), "utf8");
  const start = html.indexOf("function pushUndo()");
  const end = html.indexOf("function clone(x)", start);
  assert.ok(start >= 0 && end > start, "Undo and Redo functions should be present in the scheduler page");
  const context = {
    state: { value: "A", view: { mode: "working", siteFilter: "all", rangeStart: "2026-11-02" } },
    undoStack: [],
    redoStack: [],
    undoSuspended: false,
    mode: "working",
    siteFilter: "all",
    selected: null,
    selectedRow: null,
    selectedCells: new Set(),
    rangeInput: { value: "2026-11-02" },
    renderCount: 0,
    alerts: [],
  };
  context.$ = (id) => { assert.equal(id, "rangeStart"); return context.rangeInput; };
  context.render = () => { context.renderCount += 1; };
  context.alert = (message) => { context.alerts.push(message); };
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}\nglobalThis.historyApi = { withUndo, undoLast, redoLast, getState: () => state, setState: (next) => { state = next; } };`, context);
  return context;
}

test("Undo and Redo round-trip multiple scheduler edits", async () => {
  const context = await makeHistoryHarness();
  const { historyApi: history } = context;
  const edit = (value) => history.withUndo(() => {
    history.setState({ ...history.getState(), value });
    context.render();
  });

  edit("B");
  edit("C");
  history.undoLast();
  assert.equal(history.getState().value, "B");
  history.undoLast();
  assert.equal(history.getState().value, "A");
  history.redoLast();
  assert.equal(history.getState().value, "B");
  history.redoLast();
  assert.equal(history.getState().value, "C");
  assert.equal(context.renderCount, 6);
});

test("a new edit after Undo clears Redo history", async () => {
  const context = await makeHistoryHarness();
  const { historyApi: history } = context;
  history.withUndo(() => history.setState({ ...history.getState(), value: "B" }));
  history.undoLast();
  assert.equal(history.getState().value, "A");
  history.withUndo(() => history.setState({ ...history.getState(), value: "D" }));
  history.redoLast();
  assert.equal(history.getState().value, "D");
  assert.deepEqual(context.alerts, ["Nothing to redo."]);
});
