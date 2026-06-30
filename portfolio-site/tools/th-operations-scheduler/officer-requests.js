(() => {
  "use strict";

  const ADMIN_API = "api/officer-admin";
  const PUBLIC_LINK = `${location.origin}/officer-schedule/`;
  const requestLabels = {
    pto: "PTO",
    unpaid: "Unpaid Day Off",
    "late-in": "Late Arrival",
    "late-out": "Early Leave"
  };

  let officerData = { requests: [], acknowledgements: [], officers: [] };
  let panelOpen = false;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const normalizeName = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  const parseDate = (value) => {
    const [year, month, day] = String(value).split("-").map(Number);
    return new Date(year, month - 1, day);
  };
  const shortDate = (value) => {
    if (!value) return "";
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(parseDate(value));
  };

  function init() {
    document.body.insertAdjacentHTML("beforeend", `
      <button class="officer-admin-button" id="officerAdminButton" type="button">
        Officer Requests <span id="officerAdminCount">0</span>
      </button>
      <aside class="officer-admin-panel" id="officerAdminPanel" aria-label="Officer request panel">
        <div class="officer-admin-head">
          <div>
            <p>Officer link</p>
            <h2>Requests and signatures</h2>
          </div>
          <button type="button" id="closeOfficerPanel" aria-label="Close">x</button>
        </div>
        <div class="officer-link-row">
          <input id="officerPublicLink" readonly value="${escapeHtml(PUBLIC_LINK)}" />
          <button type="button" id="copyOfficerLink">Copy</button>
        </div>
        <div id="officerAdminBody"></div>
      </aside>
    `);

    document.getElementById("officerAdminButton").addEventListener("click", () => togglePanel(true));
    document.getElementById("closeOfficerPanel").addEventListener("click", () => togglePanel(false));
    document.getElementById("copyOfficerLink").addEventListener("click", copyOfficerLink);
    document.getElementById("officerAdminBody").addEventListener("click", handlePanelClick);

    wrapRender();
    loadOfficerData();
    window.setInterval(loadOfficerData, 10000);
  }

  function wrapRender() {
    if (typeof render !== "function") return;
    const schedulerRender = render;
    render = function renderWithOfficerRequests() {
      schedulerRender();
      applyScheduleMarkers();
    };
    applyScheduleMarkers();
  }

  async function loadOfficerData() {
    try {
      const response = await fetch(ADMIN_API, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Officer requests could not be loaded");
      officerData = payload;
      renderPanel();
      applyScheduleMarkers();
    } catch (error) {
      const body = document.getElementById("officerAdminBody");
      if (body) body.innerHTML = `<div class="officer-admin-empty">${escapeHtml(error.message)}</div>`;
    }
  }

  function renderPanel() {
    const pending = officerData.requests.filter((request) => request.status === "pending");
    document.getElementById("officerAdminCount").textContent = String(pending.length);
    const requestsHtml = officerData.requests.length
      ? officerData.requests.map(renderRequest).join("")
      : '<div class="officer-admin-empty">No officer requests yet.</div>';
    const signaturesHtml = renderSignatures();
    document.getElementById("officerAdminBody").innerHTML = `
      <section>
        <h3>Requests</h3>
        ${requestsHtml}
      </section>
      <section>
        <h3>Read signatures</h3>
        ${signaturesHtml}
      </section>
    `;
  }

  function renderRequest(request) {
    const range = request.startDate === request.endDate ? shortDate(request.startDate) : `${shortDate(request.startDate)} - ${shortDate(request.endDate)}`;
    const email = request.officerEmail || emailForOfficer(request.officerName);
    const subject = encodeURIComponent(emailSubjectForRequest(request));
    const body = encodeURIComponent(request.denialMessage || `Your ${requestLabels[request.type]} request for ${range} was reviewed.`);
    return `
      <article class="officer-request-card ${escapeHtml(request.status)}">
        <div class="officer-request-top">
          <strong>${escapeHtml(request.officerName)}</strong>
          <span>${escapeHtml(request.status)}</span>
        </div>
        <p>${escapeHtml(requestLabels[request.type])} | ${escapeHtml(range)}${request.requestedTime ? ` | ${escapeHtml(request.requestedTime)}` : ""}</p>
        ${request.message ? `<small>${escapeHtml(request.message)}</small>` : ""}
        ${request.denialMessage ? `<small class="denial-note">Denied reply: ${escapeHtml(request.denialMessage)}</small>` : ""}
        <div class="officer-request-actions">
          ${request.status === "pending" ? `<button type="button" data-approve-request="${escapeHtml(request.id)}">Approve</button><button class="danger" type="button" data-deny-request="${escapeHtml(request.id)}">Deny</button>` : ""}
          ${email ? `<a href="mailto:${escapeHtml(email)}?subject=${subject}&body=${body}">Email</a>` : ""}
        </div>
      </article>
    `;
  }

  function emailSubjectForRequest(request) {
    const label = requestLabels[request.type] || "Schedule";
    const status = request.status === "approved" ? "Approved" : request.status === "denied" ? "Denied" : "Pending";
    return `${label} Request ${status} ${subjectDateRange(request)}`;
  }

  function subjectDateRange(request) {
    const start = subjectDate(request.startDate);
    const end = subjectDate(request.endDate);
    return start === end ? start : `${start} to ${end}`;
  }

  function subjectDate(value) {
    if (!value) return "";
    const [year, month, day] = String(value).split("-");
    return `${month}-${day}-${year}`;
  }

  function renderSignatures() {
    const week = currentWeekStart();
    const current = officerData.acknowledgements.filter((ack) => ack.weekStart === week);
    if (!current.length) return '<div class="officer-admin-empty">No signatures for this week yet.</div>';
    return current.map((ack) => `
      <div class="officer-signature-row">
        <div><strong>${escapeHtml(ack.officerName)}</strong><small>${new Date(ack.signedAt).toLocaleString()}</small></div>
        ${ack.signatureData ? `<img src="${escapeHtml(ack.signatureData)}" alt="Signature from ${escapeHtml(ack.officerName)}" />` : ""}
      </div>
    `).join("");
  }

  async function handlePanelClick(event) {
    const approveId = event.target.closest("[data-approve-request]")?.dataset.approveRequest;
    const denyId = event.target.closest("[data-deny-request]")?.dataset.denyRequest;
    if (approveId) await resolveRequest(approveId, "approved", "");
    if (denyId) {
      const message = prompt("Message to officer explaining why this request is denied:");
      if (message && message.trim()) await resolveRequest(denyId, "denied", message.trim());
    }
  }

  async function resolveRequest(id, status, denialMessage) {
    const response = await fetch(ADMIN_API, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ id, status, denialMessage })
    });
    const payload = await response.json();
    if (!response.ok) {
      alert(payload.error || "Request could not be updated.");
      return;
    }
    await loadOfficerData();
  }

  function applyScheduleMarkers() {
    const table = document.getElementById("scheduleTable");
    if (!table || !officerData.requests.length || typeof state === "undefined") return;
    table.querySelectorAll(".officer-request-flag, .officer-dayoff-overlay").forEach((item) => item.remove());

    table.querySelectorAll(".cell[data-row][data-key]").forEach((cell) => {
      const row = (state.rows || []).find((item) => item.id === cell.dataset.row);
      const assignment = row?.assignments?.[cell.dataset.key];
      if (!assignment?.name) return;
      const requests = requestsForCell(assignment.name, cell.dataset.key);
      const dayOff = requests.find((request) => ["pto", "unpaid"].includes(request.type) && ["pending", "approved"].includes(request.status));
      const changes = requests.filter((request) => ["late-in", "late-out"].includes(request.type) && request.status === "pending");
      if (changes.length) {
        cell.insertAdjacentHTML("afterbegin", `<span class="officer-request-flag" title="${escapeHtml(changes.map((request) => requestLabels[request.type]).join(", "))}">${changes.length}</span>`);
      }
      if (dayOff) {
        cell.insertAdjacentHTML("beforeend", `<span class="officer-dayoff-overlay ${escapeHtml(dayOff.status)}">${escapeHtml(requestLabels[dayOff.type])}<small>${escapeHtml(dayOff.status)}</small></span>`);
      }
    });
  }

  function requestsForCell(name, date) {
    const target = normalizeName(name);
    return officerData.requests.filter((request) => normalizeName(request.officerName) === target && date >= request.startDate && date <= request.endDate);
  }

  function currentWeekStart() {
    const input = document.getElementById("rangeStart");
    return input?.value || state?.view?.rangeStart || "";
  }

  function emailForOfficer(name) {
    const officer = officerData.officers.find((item) => normalizeName(item.name) === normalizeName(name));
    return officer?.email || "";
  }

  function togglePanel(open) {
    panelOpen = open;
    document.getElementById("officerAdminPanel").classList.toggle("open", panelOpen);
  }

  async function copyOfficerLink() {
    const input = document.getElementById("officerPublicLink");
    input.select();
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      document.execCommand("copy");
    }
  }

  init();
})();
