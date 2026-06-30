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
    scheduleHead: document.getElementById("scheduleHead"),
    scheduleList: document.getElementById("scheduleList"),
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
  }

  function renderSchedule() {
    if (!payload?.schedule) {
      dom.scheduleList.innerHTML = '<div class="empty-state">No published cloud schedule is available yet.</div>';
      return;
    }

    const dates = weekDates();
    dom.scheduleList.innerHTML = dates.map((date) => viewMode === "whole" ? renderWholeDayColumn(date) : renderGuardDayColumn(currentOfficer(), date)).join("");
    if (viewMode === "whole") {
      dom.requestButton.disabled = true;
      dom.signButton.disabled = true;
      dom.nameSignButton.disabled = true;
      dom.requestButton.textContent = "Select per guard to request";
      dom.signButton.textContent = "Select per guard to sign";
      dom.nameSignButton.innerHTML = "<span>Whole schedule</span><small>Switch to per guard to sign</small>";
      return;
    }
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

  function renderWholeDayColumn(date) {
    const dateKey = iso(date);
    const shifts = shiftsForDate(dateKey);
    const cards = shifts.map((shift) => {
      const dayRequests = requestsForOfficer(shift.name).filter((request) => dateInRange(dateKey, request.startDate, request.endDate));
      const dayOffRequests = dayRequests.filter((request) => ["pto", "unpaid"].includes(request.type) && ["pending", "approved"].includes(request.status));
      const changeRequests = dayRequests.filter((request) => ["late-in", "late-out"].includes(request.type) && request.status === "pending");
      return renderShiftCard(shift, dayOffRequests, changeRequests, true);
    }).join("");
    return `<div class="day-column" data-title="${dayNames[date.getDay()]} ${fmtDate(date)}">${cards || '<div class="off-empty">No assignments</div>'}</div>`;
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
