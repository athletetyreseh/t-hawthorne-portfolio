(() => {
  "use strict";

  const API = "/officer-schedule/api";
  const POLL_MS = 8000;
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const requestLabels = {
    pto: "PTO",
    unpaid: "Unpaid day off",
    "late-in": "Come in later",
    "late-out": "Leave later"
  };

  let payload = null;
  let weekStart = weekStartMonday(new Date());
  let selectedOfficer = localStorage.getItem("th-officer-schedule-name") || "";
  let signatureReady = false;

  const dom = {
    status: document.getElementById("syncStatus"),
    refresh: document.getElementById("refreshButton"),
    previous: document.getElementById("previousWeek"),
    next: document.getElementById("nextWeek"),
    current: document.getElementById("currentWeek"),
    weekText: document.getElementById("weekText"),
    officer: document.getElementById("officerSelect"),
    nameSignButton: document.getElementById("nameSignButton"),
    requestButton: document.getElementById("requestButton"),
    signButton: document.getElementById("signButton"),
    scheduleHead: document.getElementById("scheduleHead"),
    scheduleList: document.getElementById("scheduleList"),
    requestHistory: document.getElementById("requestHistory"),
    requestDialog: document.getElementById("requestDialog"),
    requestForm: document.getElementById("requestForm"),
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
    return payload?.officers?.find((officer) => officer.name === selectedOfficer) || payload?.officers?.[0] || { name: "", email: "" };
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
      if (!selectedOfficer || !payload.officers.some((officer) => officer.name === selectedOfficer)) {
        selectedOfficer = payload.officers[0]?.name || "";
      }
      render();
      const when = payload.updatedAt ? new Date(payload.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "just now";
      setStatus(`Live schedule loaded. Last scheduler save: ${when}`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  function render() {
    renderOfficerOptions();
    renderWeek();
    renderSchedule();
    renderHistory();
  }

  function renderOfficerOptions() {
    dom.officer.innerHTML = payload?.officers?.length
      ? payload.officers.map((officer) => `<option value="${escapeHtml(officer.name)}" ${officer.name === selectedOfficer ? "selected" : ""}>${escapeHtml(officer.name)}</option>`).join("")
      : '<option value="">No officers found</option>';
  }

  function renderWeek() {
    const dates = weekDates();
    dom.weekText.textContent = `${fmtDate(dates[0])} - ${fmtDate(dates[6])}`;
    dom.scheduleHead.innerHTML = dates.map((date) => `<div class="day-head"><span>${dayNames[date.getDay()]}</span><strong>${fmtDate(date)}</strong></div>`).join("");
  }

  function renderSchedule() {
    if (!payload?.schedule) {
      dom.scheduleList.innerHTML = '<div class="empty-state">No published cloud schedule is available yet.</div>';
      return;
    }

    const officer = currentOfficer();
    const dates = weekDates();
    dom.scheduleList.innerHTML = dates.map((date) => renderDayColumn(officer, date)).join("");
    const signed = payload.acknowledgements.some((ack) => ack.officerName === officer.name && ack.weekStart === iso(weekStart));
    dom.signButton.textContent = signed ? "Update signature" : "Sign read receipt";
    dom.nameSignButton.innerHTML = `<span>${escapeHtml(officer.name || "Select officer")}</span><small>${signed ? "Signed for this week" : "Tap name to sign"}</small>`;
  }

  function renderDayColumn(officer, date) {
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

  function renderShiftCard(shift, dayOffRequests, changeRequests) {
    const offRequest = dayOffRequests.find((request) => request.status === "approved") || dayOffRequests[0];
    const statusClass = offRequest ? (offRequest.status === "approved" ? "is-off is-approved" : "is-off") : "";
    const flag = changeRequests.length ? `<span class="request-flag" title="${escapeHtml(changeRequests.map((request) => requestLabels[request.type]).join(", "))}">${changeRequests.length}</span>` : "";
    const body = offRequest
      ? `<h3>${escapeHtml(requestLabels[offRequest.type])}</h3><p>${escapeHtml(offRequest.status)} request for this shift</p><small>${escapeHtml(shift.site)} | ${escapeHtml(shift.post)}</small>`
      : `<h3>${escapeHtml(formatScheduleTime(shift.start, shift.end))}</h3><p>${escapeHtml(shift.site)} | ${escapeHtml(shift.post)}</p><small>${escapeHtml(shift.shiftName || shift.shiftCode || "Shift")}</small>`;
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
    const today = iso(weekStart);
    dom.requestForm.elements.startDate.value = today;
    dom.requestForm.elements.endDate.value = today;
    dom.requestForm.elements.requestedTime.value = "";
    dom.requestForm.elements.message.value = "";
    dom.requestDialog.showModal();
  }

  async function submitRequest(event) {
    if (event.submitter?.value !== "submit") return;
    event.preventDefault();
    const officer = currentOfficer();
    const data = new FormData(dom.requestForm);
    dom.submitRequest.disabled = true;
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          officerName: officer.name,
          officerEmail: officer.email,
          type: data.get("type"),
          startDate: data.get("startDate"),
          endDate: data.get("endDate"),
          requestedTime: data.get("requestedTime"),
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
  dom.officer.addEventListener("change", () => {
    selectedOfficer = dom.officer.value;
    localStorage.setItem("th-officer-schedule-name", selectedOfficer);
    render();
  });
  dom.requestButton.addEventListener("click", openRequestDialog);
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
