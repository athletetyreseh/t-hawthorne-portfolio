(() => {
  "use strict";

  // The inherited scheduler remains responsible for the desktop grid. This
  // layer adds authenticated cloud persistence and the touch-first mobile view.
  const API_ROOT = new URL("api/", window.location.href);
  const SAVE_DELAY = 1000;
  const browserSave = save;
  const desktopRender = render;
  let revision = null;
  let saveTimer = 0;
  let saving = false;
  let dirty = false;
  let hydrating = true;
  let selectedMobileDate = state.view?.rangeStart || new Date().toISOString().slice(0, 10);
  let selectedMobileRow = null;

  const $id = (id) => document.getElementById(id);
  const cloneState = (value) => JSON.parse(JSON.stringify(value));
  const pad = (value) => String(value).padStart(2, "0");
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const dateAtNoon = (isoDate) => new Date(`${isoDate}T12:00:00`);
  const addIsoDays = (isoDate, amount) => {
    const date = dateAtNoon(isoDate);
    date.setDate(date.getDate() + amount);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
    const mobileStatus = $id("mobileCloudStatus");
    if (mobileStatus) {
      mobileStatus.dataset.tone = tone;
      mobileStatus.textContent = message;
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
      <div class="cloud-card-actions">
        <button type="button" data-cloud-action="import">Choose private JSON</button>
      </div>
    `);
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
    selectedMobileDate = state.view?.rangeStart || state.dates?.[0] || selectedMobileDate;
    if ($id("rangeStart")) $id("rangeStart").value = selectedMobileDate;
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
        renderMobile();
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

  render = function renderWithMobile() {
    desktopRender();
    renderMobile();
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

  const mobileRoot = document.createElement("main");
  mobileRoot.className = "mobile-scheduler";
  mobileRoot.id = "mobileScheduler";
  mobileRoot.innerHTML = `
    <header class="mobile-head">
      <div class="mobile-brand"><small>Private operations tool</small><strong>TH Operations Scheduler</strong></div>
      <div class="mobile-cloud" id="mobileCloudStatus">Loading cloud</div>
    </header>
    <div class="mobile-controls">
      <select id="mobileSite" aria-label="Site"><option value="all">Both sites</option><option>Cityscape</option><option>Block 23</option></select>
      <select id="mobileMode" aria-label="Schedule mode"><option value="working">Working week</option><option value="master">Master schedule</option></select>
      <button type="button" id="mobileMenuButton" aria-label="More actions">⋮</button>
    </div>
    <nav class="mobile-days" id="mobileDays" aria-label="Schedule day"></nav>
    <section class="mobile-shifts" id="mobileShifts"></section>
    <div class="mobile-menu" id="mobileMenu" hidden>
      <button type="button" data-mobile-action="undo">Undo last change</button>
      <button type="button" data-mobile-action="rollover">Rollover master</button>
      <button type="button" data-mobile-action="history">Restore history</button>
      <button type="button" data-mobile-action="import">Import JSON</button>
      <button type="button" data-mobile-action="export">Download JSON</button>
      <button type="button" data-mobile-action="desktop">Open desktop grid</button>
    </div>
    <div class="mobile-sheet-backdrop" id="mobileSheetBackdrop" hidden>
      <section class="mobile-sheet" role="dialog" aria-modal="true" aria-labelledby="mobileSheetTitle">
        <div class="mobile-sheet-head"><div><h2 id="mobileSheetTitle">Edit shift</h2><p id="mobileSheetMeta"></p></div><button type="button" data-close-sheet aria-label="Close">×</button></div>
        <form class="mobile-form" id="mobileShiftForm">
          <label>Status<select name="status"><option value="assigned">Assigned</option><option value="open">Open gap</option><option value="blocked">Blocked</option><option value="blank">Blank</option><option value="sick">Sick</option><option value="pto">PTO</option><option value="training">Training</option></select></label>
          <label>Employee<select name="employee"></select></label>
          <label class="wide">Custom employee<input name="customEmployee" autocomplete="off" placeholder="Add a name not in the list"></label>
          <label class="wide">Position<input name="position" autocomplete="off"></label>
          <label>Start<input name="start" inputmode="numeric" maxlength="4" placeholder="0600"></label>
          <label>End<input name="end" inputmode="numeric" maxlength="4" placeholder="1400"></label>
          <label class="wide">Notes<textarea name="note"></textarea></label>
        </form>
        <div class="mobile-sheet-actions">
          <button type="button" class="primary" data-sheet-action="save">Save shift</button>
          <button type="button" data-sheet-action="duplicate">Add row below</button>
          <button type="button" class="danger" data-sheet-action="delete">Delete row</button>
        </div>
      </section>
    </div>
  `;
  document.body.append(mobileRoot);

  function escapeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  function assignmentFor(row, isoDate) {
    const dayKey = dayNames[dateAtNoon(isoDate).getDay()];
    const source = mode === "master" ? row.master?.[dayKey] : row.assignments?.[isoDate];
    return source || { status: "blank", name: "", start: "", end: "", note: "" };
  }

  function mobileDates() {
    const start = $id("rangeStart")?.value || state.view?.rangeStart || selectedMobileDate;
    return Array.from({ length: 7 }, (_, index) => addIsoDays(start, index));
  }

  function renderMobile() {
    if (!$id("mobileScheduler")) return;
    const dates = mobileDates();
    if (!dates.includes(selectedMobileDate)) selectedMobileDate = dates[0];
    $id("mobileSite").value = siteFilter || "all";
    $id("mobileMode").value = mode;
    $id("mobileDays").innerHTML = dates.map((date) => {
      const parsed = dateAtNoon(date);
      return `<button type="button" class="${date === selectedMobileDate ? "active" : ""}" data-mobile-date="${date}">${dayNames[parsed.getDay()]}<span>${parsed.getMonth() + 1}/${parsed.getDate()}</span></button>`;
    }).join("");

    const visibleRows = (state.rows || []).filter((row) => siteFilter === "all" || row.site === siteFilter);
    const groups = new Map();
    visibleRows.forEach((row) => {
      const key = `${row.site} · ${row.shiftName}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });

    let assigned = 0;
    let open = 0;
    const content = Array.from(groups.entries()).map(([group, rows]) => {
      const cards = rows.map((row) => {
        const assignment = assignmentFor(row, selectedMobileDate);
        if (assignment.status === "assigned") assigned += 1;
        if (assignment.status === "open") open += 1;
        const employee = assignment.name || (assignment.status === "open" ? "Open coverage" : assignment.status || "Blank");
        const time = assignment.start && assignment.end ? `${assignment.start}–${assignment.end}` : row.time || "No time";
        return `<button class="mobile-shift-card" type="button" data-mobile-row="${escapeText(row.id)}" data-status="${escapeText(assignment.status || "blank")}"><div><strong>${escapeText(row.post)}</strong><span>${escapeText(row.shiftCode)} · ${escapeText(row.typeLabel || "Normal")}</span></div><em>${escapeText(employee)}<br>${escapeText(time)}</em></button>`;
      }).join("");
      return `<section class="mobile-group"><h2>${escapeText(group)}</h2>${cards}</section>`;
    }).join("");

    $id("mobileShifts").innerHTML = `<div class="mobile-summary"><span>${mode === "master" ? "Master schedule" : `Week of ${dates[0]}`}</span><span>${assigned} assigned · ${open} open</span></div>${content || "<p>No schedule rows are available.</p>"}`;
  }

  function openMobileSheet(rowId) {
    const row = (state.rows || []).find((item) => item.id === rowId);
    if (!row) return;
    selectedMobileRow = row;
    const assignment = assignmentFor(row, selectedMobileDate);
    const form = $id("mobileShiftForm");
    const employee = form.elements.employee;
    employee.innerHTML = `<option value=""></option>${(state.staff || []).map((name) => `<option value="${escapeText(name)}">${escapeText(name)}</option>`).join("")}`;
    form.elements.status.value = assignment.status || "blank";
    employee.value = (state.staff || []).includes(assignment.name) ? assignment.name : "";
    form.elements.customEmployee.value = assignment.name && !(state.staff || []).includes(assignment.name) ? assignment.name : "";
    form.elements.position.value = assignment.position || row.post || "";
    form.elements.start.value = assignment.start || "";
    form.elements.end.value = assignment.end || "";
    form.elements.note.value = assignment.note || "";
    $id("mobileSheetTitle").textContent = row.post;
    $id("mobileSheetMeta").textContent = `${row.site} · ${row.shiftName} · ${mode === "master" ? dayNames[dateAtNoon(selectedMobileDate).getDay()] : selectedMobileDate}`;
    $id("mobileSheetBackdrop").hidden = false;
  }

  function closeMobileSheet() {
    $id("mobileSheetBackdrop").hidden = true;
    selectedMobileRow = null;
  }

  function saveMobileShift() {
    if (!selectedMobileRow) return;
    const form = $id("mobileShiftForm");
    const status = form.elements.status.value;
    const customName = form.elements.customEmployee.value.trim();
    const selectedName = form.elements.employee.value;
    const name = customName || selectedName;
    if (customName && !(state.staff || []).includes(customName)) state.staff.push(customName);
    const assignment = {
      status,
      name: ["assigned", "sick", "pto", "training"].includes(status) ? name : "",
      position: form.elements.position.value.trim() || selectedMobileRow.post,
      start: form.elements.start.value.trim(),
      end: form.elements.end.value.trim(),
      note: form.elements.note.value.trim() || (status === "open" ? "OPEN" : "")
    };
    pushUndo();
    if (mode === "master") {
      const key = dayNames[dateAtNoon(selectedMobileDate).getDay()];
      selectedMobileRow.master[key] = assignment;
    } else {
      selectedMobileRow.assignments[selectedMobileDate] = assignment;
    }
    render();
    closeMobileSheet();
  }

  function duplicateMobileRow() {
    if (!selectedMobileRow) return;
    const copy = cloneState(selectedMobileRow);
    copy.id = `${selectedMobileRow.id}-mobile-${Date.now()}`;
    copy.key = `${selectedMobileRow.key || selectedMobileRow.id}|${copy.id}`;
    copy.typeNum = Number(selectedMobileRow.typeNum || 1) + 1;
    copy.typeLabel = `${copy.typeNum}\nNormal`;
    copy.assignments = {};
    (state.dates || mobileDates()).forEach((date) => { copy.assignments[date] = { status: "blank", name: "", start: "", end: "", note: "" }; });
    copy.master = Object.fromEntries(dayNames.map((day) => [day, { status: "blank", name: "", start: "", end: "", note: "" }]));
    const index = state.rows.findIndex((row) => row.id === selectedMobileRow.id);
    state.rows.splice(index + 1, 0, copy);
    render();
    closeMobileSheet();
  }

  function deleteMobileRow() {
    if (!selectedMobileRow || !window.confirm(`Delete the ${selectedMobileRow.post} row?`)) return;
    state.rows = state.rows.filter((row) => row.id !== selectedMobileRow.id);
    render();
    closeMobileSheet();
  }

  $id("mobileDays").addEventListener("click", (event) => {
    const date = event.target.closest("[data-mobile-date]")?.dataset.mobileDate;
    if (date) { selectedMobileDate = date; renderMobile(); }
  });

  $id("mobileShifts").addEventListener("click", (event) => {
    const rowId = event.target.closest("[data-mobile-row]")?.dataset.mobileRow;
    if (rowId) openMobileSheet(rowId);
  });

  $id("mobileSite").addEventListener("change", (event) => {
    siteFilter = event.target.value;
    render();
  });

  $id("mobileMode").addEventListener("change", (event) => {
    mode = event.target.value;
    render();
  });

  $id("mobileMenuButton").addEventListener("click", () => {
    $id("mobileMenu").hidden = !$id("mobileMenu").hidden;
  });

  $id("mobileMenu").addEventListener("click", async (event) => {
    const action = event.target.closest("[data-mobile-action]")?.dataset.mobileAction;
    if (!action) return;
    $id("mobileMenu").hidden = true;
    if (action === "undo") undoLast();
    if (action === "rollover") rollMaster();
    if (action === "history") await showHistory();
    if (action === "import") $id("jsonFile")?.click();
    if (action === "export") $id("downloadJson")?.click();
    if (action === "desktop") window.alert("Rotate to landscape or open this page on a larger screen to use the desktop grid.");
  });

  $id("mobileSheetBackdrop").addEventListener("click", (event) => {
    if (event.target === $id("mobileSheetBackdrop") || event.target.closest("[data-close-sheet]")) closeMobileSheet();
    const action = event.target.closest("[data-sheet-action]")?.dataset.sheetAction;
    if (action === "save") saveMobileShift();
    if (action === "duplicate") duplicateMobileRow();
    if (action === "delete") deleteMobileRow();
  });

  window.addEventListener("online", () => { if (dirty) persistCloud(false); else loadCloudState(); });
  window.addEventListener("offline", () => setStatus("Offline · saved locally", "offline"));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") browserSave(true); });

  setStatus("Loading cloud", "saving");
  renderMobile();
  loadCloudState();
})();
