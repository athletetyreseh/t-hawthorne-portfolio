(() => {
  "use strict";

  const API = "/officer-schedule/api";
  const POLL_MS = 2000;
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
  let viewMode = "whole";
  let signatureReady = false;
  let loading = false;

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
    if (loading) return;
    loading = true;
    if (showLoading) setStatus("Loading schedule...");
    try {
      const response = await fetch(API, { cache: "no-store", headers: { Accept: "application/json" } });
      const text = await response.text();
      let nextPayload = {};
      try { nextPayload = text ? JSON.parse(text) : {}; } catch { nextPayload = { error: text || "Schedule could not be loaded" }; }
      if (!response.ok) throw new Error(nextPayload.error || "Schedule could not be loaded");
      payload = nextPayload;
      ensureSelectedOfficer();
      render();
      const when = payload.updatedAt ? new Date(payload.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "just now";
      setStatus(`Live schedule loaded. Last scheduler save: ${when}`);
    } catch (error) {
      setStatus(payload ? `Live update delayed. Retrying...` : error.message);
    } finally {
      loading = false;
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
      const shifts = combineContinuousShifts(shiftsForOfficer(guard.name, dateKey).filter((shift) => shift.site === site));
      const cards = shifts.map((shift) => renderTableShift(shift, dateKey)).join("");
      return `<td>${cards || '<span class="off-word">OFF</span>'}</td>`;
    }).join("");
    return `
      <tr data-guard="${escapeHtml(guard.name)}" data-site="${escapeHtml(site)}">
        <td class="guard-cell">
          <strong>${escapeHtml(guard.name)}</strong>
          <span class="${hours.ot > 0 ? "has-ot" : ""}">${roundHours(hours.total)} hrs</span>
          <small>OT: ${roundHours(hours.ot)} hrs</small>
          <div class="guard-actions">
            <button class="guard-view-button" type="button" data-view-guard="${escapeHtml(guard.name)}">View</button>
            <button class="guard-download-button" type="button" data-download-guard="${escapeHtml(guard.name)}" data-download-guard-site="${escapeHtml(site)}" aria-label="Download ${escapeHtml(guard.name)} schedule">
              <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v3h14v-3" /></svg>
            </button>
          </div>
        </td>
        ${cells}
      </tr>
    `;
  }

  function renderTableShift(shift, dateKey) {
    const dayRequests = requestsForOfficer(shift.name).filter((request) => dateInRange(dateKey, request.startDate, request.endDate));
    const dayOffRequests = dayRequests.filter((request) => ["pto", "unpaid"].includes(request.type) && ["pending", "approved"].includes(request.status));
    const changeRequests = dayRequests.filter((request) => ["late-in", "late-out"].includes(request.type) && request.status === "pending");
    const flag = changeRequests.length ? `<span class="request-flag" title="${escapeHtml(changeRequests.map((request) => requestLabels[request.type]).join(", "))}">${changeRequests.length}</span>` : "";
    const offRequest = dayOffRequests.find((request) => request.status === "approved") || dayOffRequests[0];
    if (offRequest) {
      return `
        <article class="table-shift is-public-off ${offRequest.type === "pto" ? "is-pto" : "is-unpaid"}">
          ${flag}
          <strong>${escapeHtml(requestLabels[offRequest.type])}</strong>
          <span>${escapeHtml(offRequest.status)} request</span>
          <small>${escapeHtml(shift.post || shift.site || "Scheduled day")}</small>
        </article>
      `;
    }
    return `
      <article class="table-shift ${shiftStatusClass(shift)}">
        ${flag}
        <strong>${escapeHtml(formatScheduleTime(shift.start, shift.end))}</strong>
        <span>${escapeHtml(shift.post)}</span>
        <small>${escapeHtml(shiftPublicLabel(shift))}</small>
      </article>
    `;
  }

  function renderShiftCard(shift, dayOffRequests, changeRequests, showName = false) {
    const offRequest = dayOffRequests.find((request) => request.status === "approved") || dayOffRequests[0];
    const statusClass = offRequest ? `is-off ${offRequest.type === "pto" ? "is-pto" : "is-unpaid"} ${offRequest.status === "approved" ? "is-approved" : ""}` : shiftStatusClass(shift);
    const flag = changeRequests.length ? `<span class="request-flag" title="${escapeHtml(changeRequests.map((request) => requestLabels[request.type]).join(", "))}">${changeRequests.length}</span>` : "";
    const specialLabel = shiftPublicLabel(shift);
    const body = offRequest
      ? `${showName ? `<span class="guard-name">${escapeHtml(shift.name)}</span>` : ""}<h3>${escapeHtml(requestLabels[offRequest.type])}</h3><p>${escapeHtml(offRequest.status)} request</p><small>${escapeHtml(shift.site)} | ${escapeHtml(shift.post)}</small>`
      : `${showName ? `<span class="guard-name">${escapeHtml(shift.name)}</span>` : ""}<h3>${escapeHtml(formatScheduleTime(shift.start, shift.end))}</h3><p>${escapeHtml(shift.site)} | ${escapeHtml(shift.post)}</p><small>${escapeHtml(specialLabel)}</small>`;
    return `<article class="shift-card ${statusClass}">${flag}${body}</article>`;
  }

  function renderDayOffOnly(request) {
    return `<article class="shift-card is-off ${request.type === "pto" ? "is-pto" : "is-unpaid"} ${request.status === "approved" ? "is-approved" : ""}"><h3>${escapeHtml(requestLabels[request.type])}</h3><p>${escapeHtml(request.status)} request</p><small>Day off request</small></article>`;
  }

  function shiftStatusClass(shift) {
    if (shift.status === "pto") return "is-schedule-pto";
    if (shift.status === "training") return "is-training";
    return "";
  }

  function shiftPublicLabel(shift) {
    if (shift.status === "pto") return "PTO";
    if (shift.status === "training") return "Training";
    return shift.shiftName || shift.shiftCode || "Shift";
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

  function combineContinuousShifts(shifts) {
    const sorted = [...shifts].sort((a, b) => (minutesFromTime(a.start) ?? 0) - (minutesFromTime(b.start) ?? 0));
    const combined = [];
    for (const shift of sorted) {
      const previous = combined[combined.length - 1];
      if (previous && canCombineShift(previous, shift)) {
        previous.end = shift.end || previous.end;
        previous.post = uniqueJoin(previous.post, shift.post);
        previous.shiftName = uniqueJoin(previous.shiftName || previous.shiftCode, shift.shiftName || shift.shiftCode);
        previous.shiftCode = uniqueJoin(previous.shiftCode, shift.shiftCode);
      } else {
        combined.push({ ...shift });
      }
    }
    return combined;
  }

  function canCombineShift(first, second) {
    if (!first || !second || first.site !== second.site) return false;
    if ((first.status || "assigned") !== (second.status || "assigned")) return false;
    const firstEnd = minutesFromTime(first.end);
    const secondStart = minutesFromTime(second.start);
    return firstEnd != null && secondStart != null && firstEnd === secondStart;
  }

  function uniqueJoin(...values) {
    const parts = values.flatMap((value) => String(value || "").split(" + ")).map((value) => value.trim()).filter(Boolean);
    return [...new Set(parts)].join(" + ");
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
    if (!isPaidOfficerShift(shift) || !shift.start || !shift.end) return 0;
    const start = minutesFromTime(shift.start);
    const end = minutesFromTime(shift.end);
    if (start == null || end == null) return 0;
    const normalizedEnd = end <= start ? end + 1440 : end;
    return (normalizedEnd - start) / 60;
  }

  // The public schedule is a pay expectation view, not the private billable-hours view.
  function isPaidOfficerShift(shift) {
    return ["assigned", "escort", "pto", "sick", "training"].includes(shift.status || "assigned");
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
    if (viewMode === "whole") {
      dom.hoursSummary.innerHTML = "";
      return;
    }
    const totals = weeklyHoursByOfficer();
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
        return `<article class="request-item"><div><h3>${escapeHtml(requestLabels[request.type])}</h3><p>${escapeHtml(range)}${request.requestedTime ? ` at ${escapeHtml(request.requestedTime)}` : ""}</p></div><span class="status-pill ${escapeHtml(request.status)}">${escapeHtml(request.status)}</span></article>`;
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

  function downloadSitePng(site) {
    try {
      const canvas = renderSchedulePngCanvas(site);
      downloadCanvasPng(canvas, `${siteId(site)}-${iso(weekStart)}.png`);
    } catch (error) {
      console.error(error);
      setStatus(`Could not download ${site} schedule.`);
    }
  }

  function downloadGuardPng(site, guardName) {
    try {
      const canvas = renderSchedulePngCanvas(site, guardName);
      downloadCanvasPng(canvas, `${siteId(site)}-${guardName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${iso(weekStart)}.png`);
    } catch (error) {
      console.error(error);
      setStatus(`Could not download ${guardName}'s schedule.`);
    }
  }

  function viewGuardSchedule(guardName) {
    selectedOfficer = guardName;
    viewMode = "guard";
    localStorage.setItem("th-officer-schedule-name", selectedOfficer);
    render();
    dom.weekBar.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderSchedulePngCanvas(site, guardName = "") {
    const dates = weekDates();
    const guardFilter = normalizeName(guardName);
    const guards = guardsForSite(site).filter((guard) => !guardFilter || normalizeName(guard.name) === guardFilter);
    if (guardName && !guards.length) throw new Error("Guard was not found for this site.");

    const nameW = 230;
    const dayW = 186;
    const margin = 18;
    const titleH = 54;
    const headH = 48;
    const rowGap = 0;
    const rows = (guards.length ? guards : [{ name: "No assignments" }]).map((guard) => {
      const cells = dates.map((date) => exportCellItems(site, guard.name, iso(date)));
      const maxCards = Math.max(1, ...cells.map((items) => items.length));
      return { guard, cells, height: Math.max(96, 18 + maxCards * 76) };
    });
    const width = margin * 2 + nameW + dayW * 7;
    const height = margin * 2 + titleH + headH + rows.reduce((sum, row) => sum + row.height + rowGap, 0);
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    context.scale(scale, scale);

    context.fillStyle = "#101721";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#eaf2ff";
    context.font = "800 24px Arial, sans-serif";
    context.fillText(`${site} Schedule`, margin, margin + 4);
    context.fillStyle = "#9eb3cc";
    context.font = "700 14px Arial, sans-serif";
    context.fillText(`${guardName ? `${guardName} | ` : ""}Week of ${fmtDate(dates[0])} - ${fmtDate(dates[6])}`, margin, margin + 34);

    let y = margin + titleH;
    drawBox(context, margin, y, nameW, headH, "#223047", "#36577d");
    drawCenteredText(context, "Guard", margin, y + 16, nameW, "#ffffff", "800 13px Arial, sans-serif");
    dates.forEach((date, index) => {
      const x = margin + nameW + index * dayW;
      drawBox(context, x, y, dayW, headH, "#1f5f97", "#36577d");
      drawCenteredText(context, dayNames[date.getDay()], x, y + 9, dayW, "#ffffff", "800 13px Arial, sans-serif");
      drawCenteredText(context, fmtDate(date), x, y + 26, dayW, "#c3d9f0", "700 12px Arial, sans-serif");
    });
    y += headH;

    for (const row of rows) {
      const guard = row.guard;
      const hours = weeklyHoursForGuard(guard.name, site);
      drawBox(context, margin, y, nameW, row.height, "#182437", "#334761");
      context.fillStyle = "#ffffff";
      context.font = "800 13px Arial, sans-serif";
      drawWrappedText(context, guard.name, margin + 10, y + 12, nameW - 20, 17, 3);
      if (guards.length) {
        context.fillStyle = hours.ot > 0 ? "#ffcc66" : "#eaf2ff";
        context.font = "900 17px Arial, sans-serif";
        context.fillText(`${roundHours(hours.total)} hrs`, margin + 10, y + 54);
        context.fillStyle = "#7dbdf1";
        context.font = "800 12px Arial, sans-serif";
        context.fillText(`OT: ${roundHours(hours.ot)} hrs`, margin + 10, y + 75);
      }

      row.cells.forEach((items, index) => {
        const x = margin + nameW + index * dayW;
        drawBox(context, x, y, dayW, row.height, "#101a28", "#334761");
        if (!items.length) {
          drawBox(context, x + 8, y + 10, dayW - 16, 56, "#121b29", "#344762");
          drawCenteredText(context, "OFF", x, y + 29, dayW, "#7f91a8", "800 13px Arial, sans-serif");
          return;
        }
        let cardY = y + 9;
        for (const item of items) {
          drawExportShift(context, item, x + 8, cardY, dayW - 16, 66);
          cardY += 76;
        }
      });
      y += row.height + rowGap;
    }
    return canvas;
  }

  function exportCellItems(site, guardName, dateKey) {
    if (!guardName || guardName === "No assignments") return [];
    return combineContinuousShifts(shiftsForOfficer(guardName, dateKey).filter((shift) => shift.site === site)).map((shift) => {
      const dayRequests = requestsForOfficer(shift.name).filter((request) => dateInRange(dateKey, request.startDate, request.endDate));
      const dayOffRequests = dayRequests.filter((request) => ["pto", "unpaid"].includes(request.type) && ["pending", "approved"].includes(request.status));
      const offRequest = dayOffRequests.find((request) => request.status === "approved") || dayOffRequests[0];
      if (offRequest) {
        return {
          status: offRequest.type,
          title: requestLabels[offRequest.type],
          detail: `${offRequest.status} request`,
          note: shift.post || shift.site || "Scheduled day"
        };
      }
      return {
        status: shift.status || "assigned",
        title: formatScheduleTime(shift.start, shift.end),
        detail: shift.post,
        note: shiftPublicLabel(shift)
      };
    });
  }

  function drawExportShift(context, item, x, y, width, height) {
    const colors = exportShiftColors(item.status);
    drawBox(context, x, y, width, height, colors.fill, colors.stroke);
    context.fillStyle = colors.bar;
    context.fillRect(x, y, 5, height);
    context.fillStyle = "#ffffff";
    context.font = "800 13px Arial, sans-serif";
    drawWrappedText(context, item.title, x + 11, y + 8, width - 18, 15, 1);
    context.fillStyle = "#c0cee1";
    context.font = "700 11px Arial, sans-serif";
    drawWrappedText(context, item.detail, x + 11, y + 29, width - 18, 13, 2);
    context.fillStyle = "#91a7c0";
    context.font = "800 10px Arial, sans-serif";
    drawWrappedText(context, item.note, x + 11, y + 51, width - 18, 12, 1);
  }

  function exportShiftColors(status) {
    if (status === "training") return { fill: "#264360", stroke: "#3f6f93", bar: "#55c7e8" };
    if (status === "pto") return { fill: "#203b59", stroke: "#3c638c", bar: "#8cc7ff" };
    if (status === "unpaid") return { fill: "#1c334d", stroke: "#355a80", bar: "#6fa8dc" };
    return { fill: "#223047", stroke: "#334761", bar: "#1f6fb7" };
  }

  function drawBox(context, x, y, width, height, fill, stroke = "#334761") {
    context.fillStyle = fill;
    context.fillRect(x, y, width, height);
    context.strokeStyle = stroke;
    context.lineWidth = 1;
    context.strokeRect(x, y, width, height);
  }

  function drawCenteredText(context, text, x, y, width, color, font) {
    context.fillStyle = color;
    context.font = font;
    context.textAlign = "center";
    context.fillText(String(text || ""), x + width / 2, y);
    context.textAlign = "left";
  }

  function drawWrappedText(context, text, x, y, maxWidth, lineHeight, maxLines = 2) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (context.measureText(next).width <= maxWidth || !line) {
        line = next;
      } else {
        lines.push(line);
        line = word;
      }
      if (lines.length === maxLines) break;
    }
    if (line && lines.length < maxLines) lines.push(line);
    lines.forEach((value, index) => context.fillText(value, x, y + index * lineHeight));
  }

  function downloadCanvasPng(canvas, fileName) {
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = fileName;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
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
    const viewGuard = event.target.closest("[data-view-guard]")?.dataset.viewGuard;
    if (site) downloadSitePng(site);
    if (guard && guardSite) downloadGuardPng(guardSite, guard);
    if (viewGuard) viewGuardSchedule(viewGuard);
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
  window.addEventListener("focus", () => loadSchedule(false));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") loadSchedule(false);
  });
  window.setInterval(() => loadSchedule(false), POLL_MS);
})();
