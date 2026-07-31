(() => {
  "use strict";
  const button = document.getElementById("aiControl");
  if (!button || document.getElementById("aiControlPanel")) return;

  const panel = document.createElement("aside");
  panel.id = "aiControlPanel";
  panel.className = "ai-control-panel";
  panel.setAttribute("aria-label", "AI Control capability guide");
  panel.setAttribute("aria-hidden", "true");
  panel.setAttribute("inert", "");
  panel.innerHTML = `
    <header class="ai-control-head"><div><p>Scheduler automation</p><h2>AI Control</h2></div><button type="button" class="ai-control-close" data-ai-control-close aria-label="Close AI Control">×</button></header>
    <div class="ai-control-body">
      <h3>What an agent can do</h3>
      <p><strong>Code-first:</strong> use the private command API for precise routine changes, not the visual grid. Use one <code>batch</code> command for multi-cell or multi-day work; use the manual UI only if the API is genuinely unavailable.</p>
      <ul><li>Assignments, times, sick/PTO/escort statuses, notes, tags, rows/boxes, and history lookup.</li><li>Each successful command mutation automatically adds or retains a visible agent-change tag; history makes changes auditable and reversible.</li><li>Exact routine edits need no confirmation. Ambiguous targets are rejected. Clear, block, remove, rollover, and undo require one explicit <code>confirm: true</code>.</li></ul>
      <h3>Batch tag cleanup</h3>
      <p>To keep only selected tags, send one batch of explicit <code>untag</code> commands. The result reports cleared targets.</p>
      <pre class="ai-control-example">POST api/commands
{ "baseRevision": 44, "command": { "kind": "batch", "commands": [
  { "kind": "untag", "target": { "rowId": "city-lobby-a", "date": "2026-08-03" } },
  { "kind": "untag", "target": { "rowId": "city-lobby-b", "date": "2026-08-03" } }
] } }</pre>
      <h3>Machine-readable agent context</h3>
      <textarea id="aiControlManifest" class="ai-control-manifest" readonly aria-label="Copyable scheduler capability manifest">{"capabilityManifest":"/tools/th-operations-scheduler/api/capabilities","scheduleDataIncluded":false,"agentRules":{"codeFirst":"Use api/commands; batch multi-cell or multi-day work; visual UI only if unavailable","autoTag":"Every successful mutation automatically tags affected entries or rows; explicit batch untag reports cleared targets","confirmation":"Routine exact edits need no confirmation; destructive commands require confirm:true"},"nextSteps":["GET api/capabilities","GET api/state","POST api/commands with baseRevision"]}</textarea>
      <div class="ai-control-actions"><button type="button" data-ai-control-copy>Copy agent context</button><a href="api/capabilities" target="_blank" rel="noreferrer">Open manifest endpoint</a></div>
      <p class="ai-control-notice" id="aiControlNotice">Manifest content contains no schedule rows, staff, or private state.</p>
    </div>`;
  document.body.append(panel);
  const setOpen = (open) => {
    panel.classList.toggle("open", open);
    panel.setAttribute("aria-hidden", String(!open));
    panel.toggleAttribute("inert", !open);
    button.setAttribute("aria-expanded", String(open));
    if (open) panel.querySelector("[data-ai-control-close]")?.focus();
    else button.focus();
  };
  button.addEventListener("click", () => setOpen(!panel.classList.contains("open")));
  panel.addEventListener("click", async (event) => {
    if (event.target.closest("[data-ai-control-close]")) return setOpen(false);
    if (!event.target.closest("[data-ai-control-copy]")) return;
    const field = document.getElementById("aiControlManifest");
    try { await navigator.clipboard.writeText(field.value); document.getElementById("aiControlNotice").textContent = "Agent context copied."; }
    catch { field.focus(); field.select(); document.execCommand("copy"); }
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && panel.classList.contains("open")) setOpen(false); });
})();
