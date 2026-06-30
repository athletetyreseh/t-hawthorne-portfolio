(() => {
  "use strict";

  const API = "/officer-schedule/api";
  const POLL_MS = 8000;
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const requestLabels = {
    pto: "PTO",
    unpaid: "Unpaid day off",
    "late-in": "Come in later",
    "late-out": "Early leave"
  };
  const timeLabels = {
    pto: "",
    unpaid: "",
    "late-in": "Late arrival time",
    "late-out": "Early leave time"
  };
  const timeHelp = {
    pto: "",
    unpaid: "",
    "late-in": "Enter the time you are requesting to arrive.",
    "late-out": "Enter the time you are requesting to leave."
  };

  let payload = null;
  let weekStart = weekStartMonday(new Date());
  let selectedOfficer = localStorage.getItem("th-officer-schedule-name") || "";
  let viewMode = localStorage.getItem("th-officer-schedule-view") || "guard";
  let signatureReady = false;

  const dom = {
    status: document.getElementById("syncStatus"),
    refresh: document.getElementById("refreshButton"),
    previous: document.getElementById("previousWeek"),
    next: document.getElementById("nextWeek"),
    current: document.getElementById("currentWeek"),
    weekBar: document.getElementById("weekBar"),
    weekText: document.getElementById("weekText"),
    modeButtons: document.querySelectorAll("[data-view-mode]"),
    officer: document.getElementById("officerSelect"),
    pickerPanel: document.querySelector(".officer-picker-panel"),
    nameSignButton: document.getElementById("nameSignButton"),
    requestButton: document.getElementById("requestButton"),
    signButton: document.getElementById("signButton"),
    hoursSummary: document.getElementById("hoursSummary"),
    scheduleCard: document.querySelector(".schedule-card"),
    scheduleHead: document.getElementById("scheduleHead"),
    scheduleList: document.getElementById("scheduleList"),
    historyPanel: document.querySelector(".history-panel"),
    requestHistory: document.getElementById("requestHistory"),
    requestDialog: document.getElementById("requestDialog"),
    requestForm: document.getElementById("requestForm"),
    requestTimeLabel: document.getElementById("requestTimeLabel"),
    requestTimeText: document.getElementById("requestTimeText"),
    requestTimeHelp: document.getElementById("requestTimeHelp"),
    submitRequest: document.getElementById("submitRequest"),
    signatureDialog: document.getElementById("signatureDialog"),
    signatureForm: document.getElementById("signatureForm"),
    signaturePad: document.getElementById("signaturePad"),
    clearSignature: document.getElementById("clearSignature"),
    saveSignature: document.getElementById("saveSignature")
  };

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const iso = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString().slice(0, 10);
  const parseDate = (value) => {
    const [year, month, day] = String(value).split("-").map(Number);
    return new Date(year, month - 1, day);
  };
  const addDays = (date, amount) => {
    const next = new Date(date);
    next.setDate(next.getDate() + amount);
    return next;
  };
  const fmtDate = (date) => new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
  const fmtFullDate = (value) => new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(parseDate(value));

  function weekStartMonday(date) {
    const current = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = current.getDay();
    current.setDate(current.getDate() + (day === 0 ? -6 : 1 - day));
    return current;
  }

  function weekDates() {
    return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  }

  function normalizeName(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function currentOfficer() {
    return visibleOfficers().find((officer) => officer.name === selectedOfficer) || visibleOfficers()[0] || { name: "", email: "" };
  }

  function setStatus(message) {
    dom.status.textContent = message;
  }

  async function loadSchedule(showLoading = false) {
    if (showLoading) setStatus("Loading schedule...");
    try {
      const response = await fetch(API, { cache: "no-store", headers: { Accept: "application/json" } });
      const nextPayload = await response.json();
      if (!response.ok) throw new Error(nextPayload.error || "Schedule could not be loaded");
      payload = nextPayload;
      ensureSelectedOfficer();
      render();
      const when = payload.updatedAt ? new Date(payload.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "just now";
      setStatus(`Live schedule loaded. Last scheduler save: ${when}`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  function render() {
    ensureSelectedOfficer();
    renderOfficerOptions();
    renderWeek();
    renderModeControls();
    renderHoursSummary();
    renderSchedule();
    renderHistory();
  }

  function renderOfficerOptions() {
    const officers = visibleOfficers();
    dom.officer.innerHTML = officers.length
      ? officers.map((officer) => `<option value="${escapeHtml(officer.name)}" ${officer.name === selectedOfficer ? "selected" : ""}>${escapeHtml(officer.name)}</option>`).join("")
      : '<option value="">No scheduled officers this week</option>';
    dom.officer.disabled = !officers.length || viewMode === "whole";
  }

  function renderWeek() {
    const dates = weekDates();
    dom.weekText.textContent = `${fmtDate(dates[0])} - ${fmtDate(dates[6])}`;
    dom.scheduleHead.innerHTML = dates.map((date) => `<div class="day-head"><span>${dayNames[date.getDay()]}</span><strong>${fmtDate(date)}</strong></div>`).join("");
    dom.weekBar.dataset.weekTone = weekTone();
  }

  function renderModeControls() {
    dom.modeButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.viewMode === viewMode);
    });
    dom.pickerPanel.classList.toggle("whole-mode", viewMode === "whole");
    dom.pickerPanel.hidden = viewMode === "whole";
    dom.hoursSummary.hidden = viewMode === "whole";
    dom.historyPanel.hidden = viewMode === "whole";
  }

  function renderSchedule() {
    if (!payload?.schedule) {
      dom.scheduleList.innerHTML = '<div class="empty-state">No published cloud schedule is available yet.</div>';
      return;
    }

    const dates = weekDates();
    if (viewMode === "whole") {
      dom.scheduleCard.classList.add("whole-schedule-card");
      dom.scheduleHead.innerHTML = "";
      dom.scheduleList.innerHTML = renderWholeSchedule();
      return;
    }
    dom.scheduleCard.classList.remove("whole-schedule-card");
    renderWeek();
    dom.scheduleList.innerHTML = dates.map((date) => renderGuardDayColumn(currentOfficer(), date)).join("");
    const officer = currentOfficer();
    const signed = payload.acknowledgements.some((ack) => ack.officerName === officer.name && ack.weekStart === iso(weekStart));
    dom.requestButton.disabled = !officer.name;
    dom.signButton.disabled = !officer.name;
    dom.nameSignButton.disabled = !officer.name;
    dom.requestButton.textContent = "Request PTO / change";
    dom.signButton.textContent = signed ? "Update signature" : "Sign read receipt";
    dom.nameSignButton.innerHTML = `<span>${escapeHtml(officer.name || "Select officer")}</span><small>${signed ? "Signed for this week" : "Tap name to sign"}</small>`;
  }

  function renderGuardDayColumn(officer, date) {
    const dateKey = iso(date);
    const shifts = shiftsForOfficer(officer.name, dateKey);
    const dayRequests = requestsForOfficer(officer.name).filter((request) => dateInRange(dateKey, request.startDate, request.endDate));
    const dayOffRequests = dayRequests.filter((request) => ["pto", "unpaid"].includes(request.type) && ["pending", "approved"].includes(request.status));
    const changeRequests = dayRequests.filter((request) => ["late-in", "late-out"].includes(request.type) && request.status === "pending");
    let cards = shifts.map((shift) => renderShiftCard(shift, dayOffRequests, changeRequests)).join("");

    if (!cards && dayOffRequests.length) {
      cards = dayOffRequests.map((request) => renderDayOffOnly(request)).join("");
    }

    return `<div class="day-column" data-title="${dayNames[date.getDay()]} ${fmtDate(date)}">${cards || '<div class="off-empty">No assignment</div>'}</div>`;
  }

  function renderWholeSchedule() {
    return ["Cityscape", "Block 23"].map(renderSiteSchedule).join("");
  }

  function renderSiteSchedule(site) {
    const guards = guardsForSite(site);
    const safeId = siteId(site);
    const body = guards.length
      ? guards.map((guard) => renderSiteGuardRow(site, guard)).join("")
      : `<tr><td colspan="8"><div class="empty-state">No ${escapeHtml(site)} assignments this week.</div></td></tr>`;
    return `
      <section class="site-schedule-section" id="site-${safeId}" data-site="${escapeHtml(site)}">
        <div class="site-schedule-head">
          <div>
            <p class="eyebrow">${escapeHtml(site)}</p>
            <h2>Per Guard Schedule</h2>
          </div>
          <button class="secondary-button" type="button" data-download-site="${escapeHtml(site)}">Download ${escapeHtml(site)} PNG</button>
        </div>
        <div class="site-table-scroll">
          <table class="whole-schedule-table">
            <thead>
              <tr>
                <th class="guard-column">Guard</th>
                ${weekDates().map((date) => `<th>${dayNames[date.getDay()]}<small>${fmtDate(date)}</small></th>`).join("")}
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderSiteGuardRow(site, guard) {
    const hours = weeklyHoursForGuard(guard.name, site);
    const cells = weekDates().map((date) => {
      const dateKey = iso(date);
      const shifts = shiftsForOfficer(guard.name, dateKey).filter((shift) => shift.site === site);
      const cards = shifts.map((shift) => renderTableShift(shift, dateKey)).join("");
      return `<td>${cards || '<span class="off-word">OFF</span>'}</td>`;
    }).join("");
    return `
      <tr data-guard="${escapeHtml(guard.name)}" data-site="${escapeHtml(site)}">
        <td class="guard-cell">
          <strong>${escapeHtml(guard.name)}</strong>
          <span class="${hours.ot > 0 ? "has-ot" : ""}">${roundHours(hours.total)} hrs</span>
          <small>OT: ${roundHours(hours.ot)} hrs</small>
          <button type="button" data-download-guard="${escapeHtml(guard.name)}" data-download-guard-site="${escapeHtml(site)}">PNG</button>
        </td>
        ${cells}
      </tr>
    `;
  }

  function renderTableShift(shift, dateKey) {
    const dayRequests = requestsForOfficer(shift.name).filter((request) => dateInRange(dateKey, request.startDate, request.endDate));
    const changeRequests = dayRequests.filter((request) => ["late-in", "late-out"].includes(request.type) && request.status === "pending");
    const flag = changeRequests.length ? `<span class="request-flag" title="${escapeHtml(changeRequests.map((request) => requestLabels[request.type]).join(", "))}">${changeRequests.length}</span>` : "";
    return `
      <article class="table-shift">
        ${flag}
        <strong>${escapeHtml(formatScheduleTime(shift.start, shift.end))}</strong>
        <span>${escapeHtml(shift.post)}</span>
        <small>${escapeHtml(shift.shiftName || shift.shiftCode || "Shift")}</small>
      </article>
    `;
  }

  function renderShiftCard(shift, dayOffRequests, changeRequests, showName = false) {
    const offRequest = dayOffRequests.find((request) => request.status === "approved") || dayOffRequests[0];
    const statusClass = offRequest ? (offRequest.status === "approved" ? "is-off is-approved" : "is-off") : "";
    const flag = changeRequests.length ? `<span class="request-flag" title="${escapeHtml(changeRequests.map((request) => requestLabels[request.type]).join(", "))}">${changeRequests.length}</span>` : "";
    const body = offRequest
      ? `${showName ? `<span class="guard-name">${escapeHtml(shift.name)}</span>` : ""}<h3>${escapeHtml(requestLabels[offRequest.type])}</h3><p>${escapeHtml(offRequest.status)} request for this shift</p><small>${escapeHtml(shift.site)} | ${escapeHtml(shift.post)}</small>`
      : `${showName ? `<span class="guard-name">${escapeHtml(shift.name)}</span>` : ""}<h3>${escapeHtml(formatScheduleTime(shift.start, shift.end))}</h3><p>${escapeHtml(shift.site)} | ${escapeHtml(shift.post)}</p><small>${escapeHtml(shift.shiftName || shift.shiftCode || "Shift")}</small>`;
    return `<article class="shift-card ${statusClass}">${flag}${body}</article>`;
  }

  function renderDayOffOnly(request) {
    return `<article class="shift-card is-off ${request.status === "approved" ? "is-approved" : ""}"><h3>${escapeHtml(requestLabels[request.type])}</h3><p>${escapeHtml(request.status)} request</p><small>${escapeHtml(request.message || "No assigned shift for this day")}</small></article>`;
  }

  function shiftsForOfficer(officerName, dateKey) {
    const rows = activeRows();
    const normalized = normalizeName(officerName);
    const shifts = [];
    for (const row of rows) {
      const assignment = row.assignments?.[dateKey];
      if (!assignment || normalizeName(assignment.name) !== normalized) continue;
      if (["blank", "blocked"].includes(assignment.status || "blank")) continue;
      shifts.push({
        name: assignment.name || "",
        site: row.site || "",
        post: assignment.position || row.post || "",
        shiftName: row.shiftName || "",
        shiftCode: row.shiftCode || "",
        status: assignment.status || "assigned",
        start: assignment.start || "",
        end: assignment.end || ""
      });
    }
    return shifts.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  }

  function shiftsForDate(dateKey) {
    const shifts = [];
    for (const row of activeRows()) {
      const assignment = row.assignments?.[dateKey];
      if (!assignment?.name || ["blank", "blocked"].includes(assignment.status || "blank")) continue;
      shifts.push({
        name: assignment.name,
        site: row.site || "",
        post: assignment.position || row.post || "",
        shiftName: row.shiftName || "",
        shiftCode: row.shiftCode || "",
        status: assignment.status || "assigned",
        start: assignment.start || "",
        end: assignment.end || ""
      });
    }
    return shifts.sort((a, b) => String(a.start).localeCompare(String(b.start)) || a.name.localeCompare(b.name));
  }

  function guardsForSite(site) {
    const guards = new Map();
    for (const date of weekDates().map(iso)) {
      for (const shift of shiftsForDate(date)) {
        if (shift.site !== site) continue;
        const key = normalizeName(shift.name);
        if (!key || guards.has(key)) continue;
        guards.set(key, { name: shift.name });
      }
    }
    return [...guards.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function siteId(site) {
    return String(site || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  }

  function hoursForShift(shift) {
    if (shift.status !== "assigned" || !shift.start || !shift.end) return 0;
    const start = minutesFromTime(shift.start);
    const end = minutesFromTime(shift.end);
    if (start == null || end == null) return 0;
    const normalizedEnd = end <= start ? end + 1440 : end;
    return (normalizedEnd - start) / 60;
  }

  function minutesFromTime(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (digits.length < 3) return null;
    const padded = digits.padStart(4, "0").slice(0, 4);
    const hours = Number(padded.slice(0, 2));
    const minutes = Number(padded.slice(2));
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    return hours * 60 + minutes;
  }

  function weeklyHoursByOfficer() {
    const totals = new Map();
    for (const date of weekDates().map(iso)) {
      for (const shift of shiftsForDate(date)) {
        const key = normalizeName(shift.name);
        const current = totals.get(key) || { name: shift.name, total: 0 };
        current.total += hoursForShift(shift);
        totals.set(key, current);
      }
    }
    return [...totals.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function weeklyHoursForGuard(name, site = "") {
    let total = 0;
    for (const date of weekDates().map(iso)) {
      for (const shift of shiftsForOfficer(name, date)) {
        if (site && shift.site !== site) continue;
        total += hoursForShift(shift);
      }
    }
    return { total, ot: Math.max(0, total - 40) };
  }

  function renderHoursSummary() {
    const totals = weeklyHoursByOfficer();
    if (viewMode === "whole") {
      dom.hoursSummary.innerHTML = totals.length
        ? totals.map(renderHourTile).join("")
        : '<div class="empty-state">No scheduled hours for this week.</div>';
      return;
    }
    const officer = currentOfficer();
    const total = totals.find((item) => normalizeName(item.name) === normalizeName(officer.name)) || { name: officer.name, total: 0 };
    dom.hoursSummary.innerHTML = renderHourTile(total);
  }

  function renderHourTile(item) {
    const total = roundHours(item.total);
    const ot = roundHours(Math.max(0, item.total - 40));
    return `<article class="hour-tile"><span>${escapeHtml(item.name || "Scheduled hours")}</span><strong>${total} hrs</strong><small>OT: <b class="ot-hours">${ot} hrs</b></small></article>`;
  }

  function roundHours(value) {
    const rounded = Math.round(Number(value || 0) * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  }

  function visibleOfficers() {
    const byName = new Map((payload?.officers || []).map((officer) => [normalizeName(officer.name), officer]));
    const scheduled = new Map();
    for (const date of weekDates().map(iso)) {
      for (const shift of shiftsForDate(date)) {
        const key = normalizeName(shift.name);
        if (!key || scheduled.has(key)) continue;
        scheduled.set(key, byName.get(key) || { name: shift.name, email: "" });
      }
    }
    return [...scheduled.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function ensureSelectedOfficer() {
    const officers = visibleOfficers();
    if (!officers.length) {
      selectedOfficer = "";
      return;
    }
    if (!officers.some((officer) => officer.name === selectedOfficer)) {
      selectedOfficer = officers[0].name;
      localStorage.setItem("th-officer-schedule-name", selectedOfficer);
    }
  }

  function activeRows() {
    const start = iso(weekStart);
    return (payload?.schedule?.rows || []).filter((row) => {
      const hiddenRows = payload?.schedule?.hiddenRowsByScope?.[start] || {};
      if (hiddenRows[row.id] || hiddenRows[baseRowKey(row)]) return false;
      if (!row.scope) return true;
      if (row.scope === "master-only") return false;
      if (row.scope === "working-week") return row.weekStart === start;
      return true;
    }).filter((row) => !(Array.isArray(row.hiddenWeeks) && row.hiddenWeeks.includes(start)));
  }

  function baseRowKey(row) {
    return [row.site, row.shiftName, row.post, row.shiftCode, row.typeNum].join("|");
  }

  function requestsForOfficer(officerName) {
    const normalized = normalizeName(officerName);
    return (payload?.requests || []).filter((request) => normalizeName(request.officerName) === normalized);
  }

  function renderHistory() {
    if (viewMode === "whole") {
      dom.requestHistory.innerHTML = '<div class="empty-state">Switch to per guard to view one officer request history.</div>';
      return;
    }
    const officer = currentOfficer();
    const requests = requestsForOfficer(officer.name).slice(0, 8);
    dom.requestHistory.innerHTML = requests.length
      ? requests.map((request) => {
        const range = request.startDate === request.endDate ? fmtFullDate(request.startDate) : `${fmtFullDate(request.startDate)} - ${fmtFullDate(request.endDate)}`;
        return `<article class="request-item"><div><h3>${escapeHtml(requestLabels[request.type])}</h3><p>${escapeHtml(range)}${request.requestedTime ? ` at ${escapeHtml(request.requestedTime)}` : ""}</p>${request.denialMessage ? `<small>${escapeHtml(request.denialMessage)}</small>` : ""}</div><span class="status-pill ${escapeHtml(request.status)}">${escapeHtml(request.status)}</span></article>`;
      }).join("")
      : '<div class="empty-state">No requests submitted yet.</div>';
  }

  function dateInRange(date, start, end) {
    return date >= start && date <= end;
  }

  function formatScheduleTime(start, end) {
    if (!start && !end) return "Assigned";
    return `${start || ""}${start && end ? " - " : ""}${end || ""}`;
  }

  function openRequestDialog() {
    if (viewMode === "whole") return;
    if (!currentOfficer().name) return;
    const today = iso(weekStart);
    dom.requestForm.elements.startDate.value = today;
    dom.requestForm.elements.endDate.value = today;
    dom.requestForm.elements.requestedTime.value = "";
    dom.requestForm.elements.message.value = "";
    updateRequestTimeLabel();
    dom.requestDialog.showModal();
  }

  function updateRequestTimeLabel() {
    const type = dom.requestForm.elements.type.value;
    const usesTime = type === "late-in" || type === "late-out";
    dom.requestTimeLabel.classList.toggle("is-hidden", !usesTime);
    dom.requestTimeText.textContent = timeLabels[type] || "";
    dom.requestTimeHelp.textContent = timeHelp[type] || "";
    dom.requestForm.elements.requestedTime.toggleAttribute("required", usesTime);
    if (!usesTime) dom.requestForm.elements.requestedTime.value = "";
  }

  function weekTone() {
    const current = weekStartMonday(new Date());
    const diff = Math.round((weekStart - current) / (7 * 24 * 60 * 60 * 1000));
    if (diff < 0) return "past";
    if (diff === 0) return "current";
    if (diff === 1) return "next";
    return "future";
  }

  async function submitRequest(event) {
    if (event.submitter?.value !== "submit") return;
    event.preventDefault();
    const officer = currentOfficer();
    const data = new FormData(dom.requestForm);
    const type = data.get("type");
    dom.submitRequest.disabled = true;
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          officerName: officer.name,
          officerEmail: officer.email,
          type,
          startDate: data.get("startDate"),
          endDate: data.get("endDate"),
          requestedTime: type === "late-in" || type === "late-out" ? data.get("requestedTime") : "",
          message: data.get("message")
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Request could not be submitted");
      dom.requestDialog.close();
      await loadSchedule(false);
    } catch (error) {
      setStatus(error.message);
    } finally {
      dom.submitRequest.disabled = false;
    }
  }

  function setupSignaturePad() {
    if (signatureReady) return;
    signatureReady = true;
    const canvas = dom.signaturePad;
    const context = canvas.getContext("2d");
    context.lineWidth = 5;
    context.lineCap = "round";
    context.strokeStyle = "#122033";
    let drawing = false;

    const point = (event) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * canvas.width,
        y: ((event.clientY - rect.top) / rect.height) * canvas.height
      };
    };

    canvas.addEventListener("pointerdown", (event) => {
      drawing = true;
      canvas.setPointerCapture(event.pointerId);
      const next = point(event);
      context.beginPath();
      context.moveTo(next.x, next.y);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!drawing) return;
      const next = point(event);
      context.lineTo(next.x, next.y);
      context.stroke();
    });
    canvas.addEventListener("pointerup", () => { drawing = false; });
    canvas.addEventListener("pointercancel", () => { drawing = false; });
  }

  function clearSignature() {
    const context = dom.signaturePad.getContext("2d");
    context.clearRect(0, 0, dom.signaturePad.width, dom.signaturePad.height);
  }

  async function saveSignature(event) {
    if (event.submitter?.value !== "submit") return;
    event.preventDefault();
    const officer = currentOfficer();
    dom.saveSignature.disabled = true;
    try {
      const response = await fetch(`${API}?action=acknowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          officerName: officer.name,
          officerEmail: officer.email,
          weekStart: iso(weekStart),
          signatureData: dom.signaturePad.toDataURL("image/png")
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Signature could not be saved");
      dom.signatureDialog.close();
      clearSignature();
      await loadSchedule(false);
    } catch (error) {
      setStatus(error.message);
    } finally {
      dom.saveSignature.disabled = false;
    }
  }

  async function downloadSitePng(site) {
    const section = document.getElementById(`site-${siteId(site)}`);
    if (!section) return;
    await downloadElementPng(section, `${siteId(site)}-${iso(weekStart)}.png`);
  }

  async function downloadGuardPng(site, guardName) {
    const row = [...dom.scheduleList.querySelectorAll("tr[data-site][data-guard]")]
      .find((item) => item.dataset.site === site && item.dataset.guard === guardName);
    const section = document.getElementById(`site-${siteId(site)}`);
    if (!row || !section) return;
    const wrapper = document.createElement("section");
    wrapper.className = "site-schedule-section export-single-guard";
    wrapper.innerHTML = `
      <div class="site-schedule-head">
        <div>
          <p class="eyebrow">${escapeHtml(site)}</p>
          <h2>${escapeHtml(guardName)} | Week of ${escapeHtml(fmtDate(weekStart))}</h2>
        </div>
      </div>
      <div class="site-table-scroll">
        <table class="whole-schedule-table">
          ${section.querySelector("thead").outerHTML}
          <tbody></tbody>
        </table>
      </div>
    `;
    wrapper.querySelector("tbody").append(row.cloneNode(true));
    wrapper.querySelectorAll("button").forEach((button) => button.remove());
    wrapper.style.position = "fixed";
    wrapper.style.left = "-10000px";
    wrapper.style.top = "0";
    wrapper.style.width = `${Math.max(section.scrollWidth, 1100)}px`;
    document.body.append(wrapper);
    await downloadElementPng(wrapper, `${siteId(site)}-${guardName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${iso(weekStart)}.png`);
    wrapper.remove();
  }

  async function downloadElementPng(element, fileName) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll("button").forEach((button) => button.remove());
    clone.querySelectorAll(".site-table-scroll").forEach((item) => {
      item.style.overflow = "visible";
    });
    const width = Math.ceil(Math.max(element.scrollWidth, element.getBoundingClientRect().width, 900));
    const height = Math.ceil(Math.max(element.scrollHeight, element.getBoundingClientRect().height, 300));
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    clone.style.width = `${width}px`;
    clone.style.minHeight = `${height}px`;
    clone.style.background = "#172233";

    const css = stylesheetText();
    const html = new XMLSerializer().serializeToString(clone);
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml">
            <style>${css}</style>
            ${html}
          </div>
        </foreignObject>
      </svg>
    `;
    const image = new Image();
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = width * 2;
      canvas.height = height * 2;
      const context = canvas.getContext("2d");
      context.scale(2, 2);
      context.fillStyle = "#172233";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0);
      const pngUrl = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = pngUrl;
      link.download = fileName;
      link.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function stylesheetText() {
    let css = "";
    for (const sheet of document.styleSheets) {
      try {
        css += [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
      } catch {
        // Ignore inaccessible browser/extension stylesheets.
      }
    }
    return css;
  }

  dom.refresh.addEventListener("click", () => loadSchedule(true));
  dom.previous.addEventListener("click", () => { weekStart = addDays(weekStart, -7); render(); });
  dom.next.addEventListener("click", () => { weekStart = addDays(weekStart, 7); render(); });
  dom.current.addEventListener("click", () => { weekStart = weekStartMonday(new Date()); render(); });
  dom.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      viewMode = button.dataset.viewMode;
      localStorage.setItem("th-officer-schedule-view", viewMode);
      render();
    });
  });
  dom.officer.addEventListener("change", () => {
    selectedOfficer = dom.officer.value;
    localStorage.setItem("th-officer-schedule-name", selectedOfficer);
    render();
  });
  dom.requestButton.addEventListener("click", openRequestDialog);
  dom.scheduleList.addEventListener("click", (event) => {
    const site = event.target.closest("[data-download-site]")?.dataset.downloadSite;
    const guard = event.target.closest("[data-download-guard]")?.dataset.downloadGuard;
    const guardSite = event.target.closest("[data-download-guard-site]")?.dataset.downloadGuardSite;
    if (site) downloadSitePng(site);
    if (guard && guardSite) downloadGuardPng(guardSite, guard);
  });
  dom.requestForm.elements.type.addEventListener("change", updateRequestTimeLabel);
  const openSignatureDialog = () => {
    setupSignaturePad();
    clearSignature();
    dom.signatureDialog.showModal();
  };
  dom.signButton.addEventListener("click", openSignatureDialog);
  dom.nameSignButton.addEventListener("click", openSignatureDialog);
  dom.requestForm.addEventListener("submit", submitRequest);
  dom.signatureForm.addEventListener("submit", saveSignature);
  dom.clearSignature.addEventListener("click", clearSignature);
  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });

  loadSchedule(true);
  window.setInterval(() => loadSchedule(false), POLL_MS);
})();
