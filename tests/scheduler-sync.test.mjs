import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../portfolio-site/tools/th-operations-scheduler/sync-merge.js';
const { merge } = globalThis.SchedulerSync;
const copy = v => JSON.parse(JSON.stringify(v));
const seed = () => ({ rows: [{ id: 'a', assignments: { mon: { status: 'assigned', name: 'A', start: '0800' } }, master: {} }], staff: ['A'], view: {} });
test('separate cells, remote rows and staff survive concurrent saves', () => {
  const base = seed(), local = copy(base), remote = copy(base);
  local.rows[0].assignments.mon.name = 'B';
  remote.rows[0].assignments.tue = { status: 'open' };
  remote.rows.push({id: 'b', assignments: {}}); remote.staff.push('C');
  const result = merge(base, local, remote);
  assert.equal(result.rows[0].assignments.mon.name, 'B');
  assert.equal(result.rows[0].assignments.tue.status, 'open');
  assert.equal(result.rows.length, 2); assert.deepEqual(result.staff, ['A', 'C']);
});
test('same-cell edit stays atomic and deletions do not resurrect untouched rows', () => {
  const base = seed(), local = copy(base), remote = copy(base);
  local.rows[0].assignments.mon.name = 'B'; remote.rows[0].assignments.mon.start = '0900';
  assert.deepEqual(merge(base, local, remote).rows[0].assignments.mon, local.rows[0].assignments.mon);
  local.rows = []; assert.deepEqual(merge(base, local, remote).rows, []);
  assert.deepEqual(merge(base, base, { ...base, rows: [] }).rows, []);
});
function harness(initial = seed()) {
  const storage = () => { const data = new Map(); return {getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}; };
  const status = {classList:{add(){}},dataset:{},setAttribute(){}};
  const overlay = {hidden:true}; const timers = [];
  const context = vm.createContext({state:copy(initial), save(){}, render(){}, mode:'working',siteFilter:'all',iso:()=> '2026-09-14',weekStartMonday:()=>new Date(),
    localStorage:storage(),sessionStorage:storage(), navigator:{onLine:true}, console, URL, AbortSignal,
    document:{visibilityState:'visible',hasFocus:()=>true,getElementById:id=>id==='saveStatus'?status:null,createElement:()=>overlay,body:{append(){}}},
    clearTimeout(){},fetch:async(...args)=>context.respond(...args)});
  context.window={location:{href:'https://example.com/tools/th-operations-scheduler/'},SchedulerSync:globalThis.SchedulerSync,setTimeout:fn=>{timers.push(fn);return timers.length}};
  let source = fs.readFileSync('portfolio-site/tools/th-operations-scheduler/cloud-sync.js','utf8');
  source = source.slice(0,source.indexOf('  const showHistory =')) + 'globalThis.sync = {loadCloudState,persistCloud,scheduleCloudSave, inspect:()=>({dirty,saving,revision,baseState})};})();';
  vm.runInContext(source,context);
  const response = (state,revision=1,status=200) => ({ok:status<400,status,text:async()=>JSON.stringify({state,revision})});
  context.respond=async()=>response(initial);
  return {context, timers, status, overlay, response};
}
test('409 reconciles without modal then saves against refreshed revision', async () => {
  const h=harness(); await h.context.sync.loadCloudState();
  h.context.state.rows[0].assignments.mon.name='B'; h.context.sync.scheduleCloudSave();
  const remote=seed();remote.rows[0].assignments.tue={status:'open'};
  const writes=[];
  h.context.respond=async(url,options)=>{
    if(options.method==='PUT') {writes.push(JSON.parse(options.body));return h.response(null,2,writes.length===1?409:200);}
    return h.response(remote,2);
  };
  await h.context.sync.persistCloud(); await h.context.sync.persistCloud();
  assert.equal(h.overlay.hidden,true);assert.equal(writes[1].baseRevision,2);
  assert.equal(writes[1].force,false);assert.equal(writes[1].state.rows[0].assignments.mon.name,'B');
  assert.equal(writes[1].state.rows[0].assignments.tue.status,'open');assert.equal(h.context.sync.inspect().dirty,false);
});
test('edits made during a PUT stay journaled and are saved next', async () => {
  const h=harness();await h.context.sync.loadCloudState();
  h.context.state.staff.push('B');h.context.sync.scheduleCloudSave();
  let resolve;h.context.respond=()=>new Promise(r=>resolve=r);
  const saving=h.context.sync.persistCloud();h.context.state.staff.push('C');h.context.sync.scheduleCloudSave();
  resolve(h.response(null,2));await saving;
  assert.equal(h.context.sync.inspect().dirty,true);
  const pending=JSON.parse(h.context.sessionStorage.getItem('thOperationsSchedulerPendingCloudSave'));
  assert.equal(pending.baseRevision,2);assert.deepEqual(pending.state.staff,['A','B','C']);
});
test('failed request releases lock and retries even with history overlay open', async () => {
  const h=harness(); await h.context.sync.loadCloudState();h.context.state.staff.push('B');h.context.sync.scheduleCloudSave();
  h.overlay.hidden=false;h.context.console={error(){}};h.context.respond=async()=>{throw new Error('timeout')};
  await h.context.sync.persistCloud();assert.equal(h.context.sync.inspect().saving,false);
  assert.equal(h.context.sync.inspect().dirty,true);assert.ok(h.timers.length>=2);
});
test('pending recovery merges once without reopening conflict dialog', async () => {
  const h=harness(), base=seed(), local=seed(), remote=seed();local.staff.push('B');remote.staff.push('C');
  h.context.localStorage.setItem('thOperationsSchedulerPendingCloudSave',JSON.stringify({state:local,baseState:base,baseRevision:1}));
  h.context.respond=async()=>h.response(remote,2);await h.context.sync.loadCloudState();
  assert.deepEqual(copy(h.context.state.staff),['A','C','B']);assert.equal(h.overlay.hidden,true);
});
test('edits during a focus refresh are reconciled rather than replaced', async () => {
  const h=harness();await h.context.sync.loadCloudState();let resolve;h.context.respond=()=>new Promise(r=>resolve=r);
  const loading=h.context.sync.loadCloudState();h.context.state.staff.push('B');h.context.sync.scheduleCloudSave();
  const remote=seed();remote.staff.push('C');resolve(h.response(remote,2));await loading;
  assert.deepEqual(copy(h.context.state.staff),['A','C','B']);
});
test('legacy recovery without a baseline retains cloud-only rows', async () => {
  const local=seed(), h=harness(local), remote=seed();local.staff.push('B');
  h.context.state=copy(local);
  const hash=JSON.stringify({rows:local.rows,staff:local.staff});
  h.context.localStorage.setItem('thOperationsSchedulerPendingCloudSave',JSON.stringify({hash,baseRevision:1}));
  remote.rows.push({id:'remote',assignments:{}});h.context.respond=async()=>h.response(remote,2);
  await h.context.sync.loadCloudState();assert.equal(h.context.state.rows.length,2);
  assert.equal(h.context.state.staff.includes('B'),true);
});
test('dirty tab saves without requiring browser focus or a tab ownership lease', async () => {
  const h=harness();await h.context.sync.loadCloudState();h.context.state.staff.push('B');
  h.context.document.hasFocus=()=>false;h.context.document.visibilityState='hidden';
  let wrote=false;h.context.respond=async()=>{wrote=true;return h.response(null,2)};
  h.context.sync.scheduleCloudSave();await h.context.sync.persistCloud();assert.equal(wrote,true);
});
test('rendered state does not share mutable rows with the merge baseline', async () => {
  const h=harness();await h.context.sync.loadCloudState();h.context.state.staff.push('B');h.context.sync.scheduleCloudSave();
  h.context.respond=async(url,options)=>options.method==='PUT'?h.response(null,2,409):h.response(seed(),2);
  await h.context.sync.persistCloud();h.context.state.rows[0].assignments.mon.name='C';
  assert.equal(h.context.sync.inspect().baseState.rows[0].assignments.mon.name,'A');
});
test('reverting an edit during its save keeps the revert recoverable', async () => {
  const h=harness();await h.context.sync.loadCloudState();h.context.state.staff.push('B');h.context.sync.scheduleCloudSave();
  let resolve;h.context.respond=()=>new Promise(r=>resolve=r);const saving=h.context.sync.persistCloud();
  h.context.state.staff.pop();h.context.sync.scheduleCloudSave();
  assert.deepEqual(JSON.parse(h.context.sessionStorage.getItem('thOperationsSchedulerPendingCloudSave')).state.staff,['A']);
  resolve(h.response(null,2));await saving;assert.equal(h.context.sync.inspect().dirty,true);
});
