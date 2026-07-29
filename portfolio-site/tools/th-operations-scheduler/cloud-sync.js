(() => {
  "use strict";

  // The inherited scheduler owns the interface on every screen size. This
  // layer adds authenticated cloud persistence without creating a second UI.
  const API_ROOT = new URL("api/", window.location.href);
  const SAVE_DELAY = 1000;
  const ACTIVE_TAB_KEY = "thOperationsSchedulerActiveTab";
  const ACTIVE_TAB_TTL = 15000;
  const tabId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const browserSave = save;
  let revision = null;
  let saveTimer = 0;
  let saving = false;
  let dirty = false;
  let hydrating = true;
  let lastCloudHash = "";
  let lastFocusCloudLoad = 0;

  const $id = (id) => document.getElementById(id);
  const cloneState = (value) => JSON.parse(JSON.stringify(value));
  const cloudHash = (value) => {
    const copy = cloneState(value || {});
    delete copy.view;
    delete copy.lastSaved;
    return JSON.stringify(copy);
  };
  const escapeText = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

  const readActiveTab = () => {
    try { return JSON.parse(localStorage.getItem(ACTIVE_TAB_KEY) || "null"); }
    catch { return null; }
  };

  const claimActiveTab = () => {
    if (document.visibilityState !== "visible") return;
    try {
      localStorage.setItem(ACTIVE_TAB_KEY, JSON.stringify({ id: tabId, updatedAt: Date.now() }));
    } catch {}
  };

  const isActiveSchedulerTab = () => {
    if (document.visibilityState !== "visible" || !document.hasFocus()) return false;
    const active = readActiveTab();
    return active?.id === tabId && Date.now() - Number(active.updatedAt || 0) < ACTIVE_TAB_TTL;
  };

  const showCurrentWeek = () => {
    const currentMonday = iso(weekStartMonday(new Date()));
    state.view = { ...(state.view || {}), rangeStart: currentMonday };
    if ($id("rangeStart")) $id("rangeStart").value = currentMonday;
    return currentMonday;
  };

  const cloudOverlay = document.createElement("div");
  cloudOverlay.className = "cloud-overlay";
  cloudOverlay.hidden = true;
  document.body.append(cloudOverlay);

  const setStatus = (message, tone = "idle") => {
    const status = $id("saveStatus");
    if (status) {
      status.classList.add("cloud-state");
      status.dataset.tone = tone;
      status.textContent = message;
    }
  };

  const showOverlay = (content) => {
    cloudOverlay.innerHTML = `<section class="cloud-card">${content}</section>`;
    cloudOverlay.hidden = false;
  };

  const hideOverlay = () => {
    cloudOverlay.hidden = true;
    cloudOverlay.innerHTML = "";
  };

  const showEmptyState = () => {
    showOverlay(`
      <h2>Import your private schedule</h2>
      <p>No cloud schedule exists yet. Choose the private JSON migration file once; it will be stored in your authenticated cloud workspace.</p>
      <label class="cloud-paste-label" for="cloudPasteJson">Or paste the private JSON</label>
      <textarea id="cloudPasteJson" class="cloud-paste-json" spellcheck="false" autocomplete="off" placeholder="Paste scheduler JSON here"></textarea>
      <div class="cloud-card-actions">
        <button type="button" data-cloud-action="import">Choose private JSON</button>
        <button class="secondary" type="button" data-cloud-action="paste-import">Import pasted JSON</button>
      </div>
    `);
  };

  const importPastedJson = async () => {
    const input = $id("cloudPasteJson");
    try {
      const imported = JSON.parse(input?.value || "");
      if (!imported || !Array.isArray(imported.rows) || !Array.isArray(imported.staff)) {
        throw new Error("The pasted JSON is not a valid scheduler export.");
      }
      hydrating = true;
      state = cloneState(imported);
      mode = state.view?.mode || "working";
      siteFilter = state.view?.siteFilter || "all";
      showCurrentWeek();
      render();
      browserSave(true);
      hydrating = false;
      dirty = true;
      await persistCloud(true);
    } catch (error) {
      showOverlay(`<h2>Import failed</h2><p>${escapeText(error.message)}</p><div class="cloud-card-actions"><button class="secondary" data-cloud-action="reload">Try again</button></div>`);
    }
  };

  const showConflict = (serverRevision, updatedAt) => {
    const when = updatedAt ? new Date(updatedAt).toLocaleString() : "recently";
    showOverlay(`
      <h2>A newer cloud schedule exists</h2>
      <p>Another tab or device saved revision ${serverRevision} ${when}. Choose which copy should remain current.</p>
      <div class="cloud-card-actions">
        <button type="button" data-cloud-action="reload">Load cloud version</button>
        <button class="secondary" type="button" data-cloud-action="overwrite">Overwrite with this device</button>
      </div>
    `);
  };

  const parseJsonResponse = async (response) => {
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return { error: text }; }
  };

  const applyCloudState = (payload) => {
    hydrating = true;
    state = cloneState(payload.state);
    revision = Number(payload.revision || 0);
    mode = state.view?.mode || "working";
    siteFilter = state.view?.siteFilter || "all";
    showCurrentWeek();
    render();
    browserSave(true);
    lastCloudHash = cloudHash(state);
    hydrating = false;
    dirty = false;
    hideOverlay();
    setStatus(`Cloud saved · r${revision}`, "saved");
  };

  const loadCloudState = async () => {
    setStatus("Loading cloud", "saving");
    try {
      const response = await fetch(new URL("state", API_ROOT), {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      if (response.status === 404) {
        hydrating = false;
        if (state.rows?.length) {
          dirty = true;
          await persistCloud(true);
        } else {
          setStatus("Setup required", "offline");
          showEmptyState();
        }
        return;
      }
      const payload = await parseJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || `Cloud load failed (${response.status})`);
      applyCloudState(payload);
    } catch (error) {
      hydrating = false;
      if (state.rows?.length) {
        setStatus("Offline · local copy", "offline");
        hydrating = true;
        showCurrentWeek();
        render();
        hydrating = false;
      } else {
        showOverlay(`<h2>Cloud schedule unavailable</h2><p>${escapeText(error.message)} Try again when your connection is available.</p><div class="cloud-card-actions"><button data-cloud-action="reload">Try again</button></div>`);
        setStatus("Cloud unavailable", "error");
      }
    }
  };

  const scheduleCloudSave = () => {
    const currentHash = cloudHash(state);
    if (currentHash === lastCloudHash) {
      dirty = false;
      clearTimeout(saveTimer);
      setStatus(`Cloud saved · r${revision || 0}`, "saved");
      return;
    }
    dirty = true;
    clearTimeout(saveTimer);
    setStatus("Saved locally", "saving");
    if (!isActiveSchedulerTab()) return;
    saveTimer = window.setTimeout(() => persistCloud(false), SAVE_DELAY);
  };

  const persistCloud = async (force = false, retryCount = 0) => {
    if (hydrating || !state.rows?.length) return;
    if (!force && !isActiveSchedulerTab()) return;
    if (saving) {
      dirty = true;
      return;
    }

    saving = true;
    dirty = false;
    setStatus("Saving to cloud", "saving");
    const snapshot = cloneState(state);
    const snapshotHash = cloudHash(snapshot);
    if (!force && snapshotHash === lastCloudHash) {
      saving = false;
      setStatus(`Cloud saved · r${revision || 0}`, "saved");
      return;
    }
    const shouldForce = force || isActiveSchedulerTab();

    try {
      const response = await fetch(new URL("state", API_ROOT), {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ state: snapshot, baseRevision: revision, force: shouldForce })
      });
      const payload = await parseJsonResponse(response);
      if (response.status === 409) {
        revision = Number(payload.revision || revision || 0);
        if (isActiveSchedulerTab() && retryCount < 2) {
          saving = false;
          return persistCloud(true, retryCount + 1);
        }
        showConflict(payload.revision, payload.updatedAt);
        setStatus("Save conflict", "error");
        return;
      }
      if (!response.ok) throw new Error(payload.error || `Cloud save failed (${response.status})`);
      revision = Number(payload.revision || revision || 1);
      lastCloudHash = snapshotHash;
      hideOverlay();
      setStatus(`Cloud saved · r${revision}`, "saved");
    } catch (error) {
      dirty = true;
      setStatus(navigator.onLine ? "Cloud save failed" : "Offline · saved locally", "offline");
      console.error(error);
    } finally {
      saving = false;
      if (dirty && navigator.onLine && cloudOverlay.hidden) scheduleCloudSave();
    }
  };

  const showHistory = async () => {
    showOverlay("<h2>Restore history</h2><p>Loading recent cloud restore points…</p>");
    try {
      const response = await fetch(new URL("history", API_ROOT), { credentials: "same-origin", cache: "no-store" });
      const payload = await parseJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || "History could not be loaded");
      const rows = payload.versions?.length
        ? payload.versions.map((item) => `<div class="history-row"><div><strong>Revision ${item.revision}</strong><span>${new Date(item.createdAt).toLocaleString()}</span></div><button type="button" data-restore-id="${item.id}">Restore</button></div>`).join("")
        : "<p>No restore points exist yet.</p>";
      showOverlay(`<h2>Restore history</h2><p>Restoring creates a new revision; it does not delete the current copy.</p><div class="history-list">${rows}</div><div class="cloud-card-actions"><button class="secondary" data-cloud-action="close">Close</button></div>`);
    } catch (error) {
      showOverlay(`<h2>History unavailable</h2><p>${escapeText(error.message)}</p><div class="cloud-card-actions"><button class="secondary" data-cloud-action="close">Close</button></div>`);
    }
  };

  const restoreVersion = async (versionId) => {
    setStatus("Restoring", "saving");
    const response = await fetch(new URL("restore", API_ROOT), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ versionId })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || "Restore failed");
    applyCloudState(payload);
  };

  const refreshCloudOnActivation = () => {
    claimActiveTab();
    if (hydrating || saving || cloudOverlay.hidden === false) return;
    if (dirty) {
      persistCloud(false);
      return;
    }
    if (Date.now() - lastFocusCloudLoad < 2500) return;
    lastFocusCloudLoad = Date.now();
    loadCloudState();
  };

  cloudOverlay.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-cloud-action]")?.dataset.cloudAction;
    const restoreId = event.target.closest("[data-restore-id]")?.dataset.restoreId;
    if (action === "import") $id("jsonFile")?.click();
    if (action === "paste-import") await importPastedJson();
    if (action === "reload") await loadCloudState();
    if (action === "overwrite") {
      claimActiveTab();
      await persistCloud(true);
    }
    if (action === "close") hideOverlay();
    if (restoreId) {
      try { await restoreVersion(Number(restoreId)); }
      catch (error) { showOverlay(`<h2>Restore failed</h2><p>${escapeText(error.message)}</p><div class="cloud-card-actions"><button class="secondary" data-cloud-action="close">Close</button></div>`); }
    }
  });

  save = function saveWithCloud(silent = true) {
    browserSave(silent);
    if (!hydrating) scheduleCloudSave();
  };

  const titleText = document.querySelector(".titlebar span");
  if (titleText && !titleText.querySelector(".private-access-badge")) {
    titleText.insertAdjacentHTML("beforeend", '<span class="private-access-badge">Private</span>');
  }

  const saveButton = $id("saveBrowser");
  if (saveButton) saveButton.textContent = "Save Now";
  const historyButton = document.createElement("button");
  historyButton.id = "cloudHistory";
  historyButton.type = "button";
  historyButton.textContent = "History";
  historyButton.addEventListener("click", showHistory);
  saveButton?.insertAdjacentElement("afterend", historyButton);

  // Scheduler change markers: tags identify post-submission changes, while notes
  // identify the reason for a shift. A tag intentionally takes visual precedence.
  const automaticNotes = new Set(["ASSIGNED", "OPEN", "ESCORT", "SICK", "PTO", "TRAINING", "BLANK", "BLOCKED"]);
  const hasShiftNote = (assignment) => {
    const note = String(assignment?.note || "").trim();
    return Boolean(note) && !automaticNotes.has(note.toUpperCase());
  };
  const assignmentForCell = (cell) => {
    const row = getRow(cell.dataset.row);
    if (!row) return null;
    return mode === "master" ? row.master[cell.dataset.key] : row.assignments[cell.dataset.key];
  };
  const noteHover = document.createElement("div");
  noteHover.id = "schedulerNoteHover";
  noteHover.setAttribute("role", "tooltip");
  document.body.append(noteHover);
  const hideNoteHover = () => { noteHover.style.display = "none"; };
  const showNoteHover = (marker) => {
    const note = marker.dataset.notePreview;
    if (!note) return;
    const rect = marker.getBoundingClientRect();
    noteHover.textContent = note;
    noteHover.style.display = "block";
    const maxLeft = Math.max(8, window.innerWidth - noteHover.offsetWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - noteHover.offsetHeight - 8);
    noteHover.style.left = `${Math.min(maxLeft, Math.max(8, rect.left))}px`;
    noteHover.style.top = `${Math.min(maxTop, rect.bottom + 5)}px`;
  };
  const decorateShiftCells = () => {
    document.querySelectorAll("#scheduleTable .cell").forEach((cell) => {
      const assignment = assignmentForCell(cell);
      const tagged = assignment?.tagged === true;
      const noted = hasShiftNote(assignment);
      const notePreview = noted ? String(assignment.note).trim() : "";
      const hasPtoRequest = Boolean(cell.querySelector(".officer-request-flag.has-dayoff"));
      const existing = cell.querySelector(".shift-change-marker");
      if (!tagged && !noted) {
        existing?.remove();
        return;
      }
      const className = `shift-change-marker ${tagged ? "is-tagged" : "has-note"}${tagged && hasPtoRequest ? " with-pto" : ""}`;
      const markerText = "";
      if (existing?.className === className && existing.textContent === markerText && (existing.dataset.notePreview || "") === notePreview) return;
      existing?.remove();
      const marker = document.createElement("span");
      marker.className = className;
      if (notePreview) marker.dataset.notePreview = notePreview;
      marker.title = tagged && !noted ? "Tagged change" : "Shift note";
      marker.setAttribute("aria-label", notePreview || marker.title);
      if (notePreview) {
        marker.addEventListener("mouseenter", () => showNoteHover(marker));
        marker.addEventListener("mouseleave", hideNoteHover);
      }
      marker.textContent = markerText;
      cell.append(marker);
    });
  };
  const notesField = () => {
    const input = $id("detailNotes");
    if (!input) return;
    if (input.type === "hidden") return;
    input.type = "hidden";
    input.value = hasShiftNote({ note: input.value }) ? input.value : "";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "scheduler-notes-toggle";
    toggle.title = "Open shift notes";
    toggle.setAttribute("aria-label", "Open shift notes");
    toggle.textContent = "📝";
    input.insertAdjacentElement("afterend", toggle);
    const panel = document.createElement("section");
    panel.className = "scheduler-notepad";
    panel.innerHTML = "<label for=\"detailNotes\">Shift notes</label><p>Use this space to explain changes or add information for Danielle.</p>";
    const textarea = document.createElement("textarea");
    textarea.placeholder = "Add a note for this shift";
    textarea.value = input.value;
    textarea.addEventListener("input", () => { input.value = textarea.value; });
    panel.append(textarea);
    input.closest(".sd-mini-grid")?.insertAdjacentElement("afterend", panel);
    toggle.addEventListener("click", () => {
      const open = panel.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.title = open ? "Close shift notes" : "Open shift notes";
      input.closest("#detailBack .detailbox")?.classList.toggle("notes-open", open);
      if (open) textarea.focus();
    });
  };
  const tagButton = document.createElement("button");
  tagButton.type = "button";
  tagButton.dataset.act = "tag";
  tagButton.id = "tagBoxAction";
  const contextMenu = $id("ctx");
  contextMenu?.prepend(tagButton);
  tagButton.textContent = "Tag";

  const keepContextMenuOnScreen = () => {
    if (!contextMenu || contextMenu.style.display !== "block") return;
    const padding = 8;
    const rect = contextMenu.getBoundingClientRect();
    const left = Math.max(padding, Math.min(rect.left, window.innerWidth - rect.width - padding));
    const top = Math.max(padding, Math.min(rect.top, window.innerHeight - rect.height - padding));
    if (Math.round(rect.left) !== Math.round(left)) contextMenu.style.left = `${left}px`;
    if (Math.round(rect.top) !== Math.round(top)) contextMenu.style.top = `${top}px`;
  };
  new MutationObserver(() => requestAnimationFrame(keepContextMenuOnScreen))
    .observe(contextMenu, { attributes: true, attributeFilter: ["style"] });

  document.addEventListener("contextmenu", (event) => {
    const cell = event.target.closest("#scheduleTable .cell");
    if (!cell) return;
    const assignment = assignmentForCell(cell);
    tagButton.textContent = assignment?.tagged ? "Remove Tag" : "Tag Box";
  }, true);
  document.addEventListener("contextmenu", (event) => {
    if (event.target.closest("#scheduleTable .cell")) requestAnimationFrame(keepContextMenuOnScreen);
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("#tagBoxAction") !== tagButton) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const current = ctxCell || selected;
    const row = current && getRow(current.row);
    if (!row) return;
    const assignment = mode === "master" ? row.master[current.key] : row.assignments[current.key];
    if (!assignment || assignment.status === "blank" || assignment.status === "blocked") return;
    withUndo(() => { assignment.tagged = !assignment.tagged; });
    contextMenu.style.display = "none";
    render();
  }, true);
  new MutationObserver(() => {
    decorateShiftCells();
    notesField();
  }).observe(document.body, { childList: true, subtree: true });
  decorateShiftCells();

  window.addEventListener("online", () => { if (dirty) persistCloud(false); else loadCloudState(); });
  window.addEventListener("offline", () => setStatus("Offline · saved locally", "offline"));
  window.addEventListener("focus", refreshCloudOnActivation);
  document.addEventListener("pointerdown", claimActiveTab, true);
  document.addEventListener("keydown", claimActiveTab, true);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      clearTimeout(saveTimer);
      browserSave(true);
      return;
    }
    refreshCloudOnActivation();
  });

  setStatus("Loading cloud", "saving");
  claimActiveTab();
  showCurrentWeek();
  render();
  loadCloudState();
})();
