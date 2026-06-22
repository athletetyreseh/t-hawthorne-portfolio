(() => {
  "use strict";

  // The inherited scheduler owns the interface on every screen size. This
  // layer adds authenticated cloud persistence without creating a second UI.
  const API_ROOT = new URL("api/", window.location.href);
  const SAVE_DELAY = 1000;
  const browserSave = save;
  let revision = null;
  let saveTimer = 0;
  let saving = false;
  let dirty = false;
  let hydrating = true;

  const $id = (id) => document.getElementById(id);
  const cloneState = (value) => JSON.parse(JSON.stringify(value));
  const escapeText = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

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
    dirty = true;
    clearTimeout(saveTimer);
    setStatus("Saved locally", "saving");
    saveTimer = window.setTimeout(() => persistCloud(false), SAVE_DELAY);
  };

  const persistCloud = async (force = false) => {
    if (hydrating || !state.rows?.length) return;
    if (saving) {
      dirty = true;
      return;
    }

    saving = true;
    dirty = false;
    setStatus("Saving to cloud", "saving");
    const snapshot = cloneState(state);

    try {
      const response = await fetch(new URL("state", API_ROOT), {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ state: snapshot, baseRevision: revision, force })
      });
      const payload = await parseJsonResponse(response);
      if (response.status === 409) {
        showConflict(payload.revision, payload.updatedAt);
        setStatus("Save conflict", "error");
        return;
      }
      if (!response.ok) throw new Error(payload.error || `Cloud save failed (${response.status})`);
      revision = Number(payload.revision || revision || 1);
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

  cloudOverlay.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-cloud-action]")?.dataset.cloudAction;
    const restoreId = event.target.closest("[data-restore-id]")?.dataset.restoreId;
    if (action === "import") $id("jsonFile")?.click();
    if (action === "paste-import") await importPastedJson();
    if (action === "reload") await loadCloudState();
    if (action === "overwrite") await persistCloud(true);
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

  window.addEventListener("online", () => { if (dirty) persistCloud(false); else loadCloudState(); });
  window.addEventListener("offline", () => setStatus("Offline · saved locally", "offline"));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") browserSave(true); });

  setStatus("Loading cloud", "saving");
  showCurrentWeek();
  render();
  loadCloudState();
})();
