(() => {
  "use strict";
  const grid = document.getElementById("resourceGrid");
  const account = document.getElementById("accountStrip");
  const status = document.getElementById("statusMessage");
  const dialog = document.getElementById("requestDialog");
  const form = document.getElementById("requestForm");
  const requestedKey = new URLSearchParams(location.search).get("request");
  let session = null;

  const resourceIcons = Object.freeze({
    life_manager: '<circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2M5 4l2 2m10-2-2 2" />',
    scheduler: '<path d="M4 5h16v15H4zM8 3v4m8-4v4M4 9h16M8 13h3m2 0h3m-8 4h3m2 0h3" />',
    fire_drill: '<path d="M13 3c1 4-2 5-2 8 0 2 1 3 3 3 2 0 3-2 3-4 2 2 3 4 3 6 0 3-3 5-8 5s-8-2-8-6c0-3 2-6 6-9 0 3 1 4 3 5" />',
    staff: '<circle cx="9" cy="8" r="3" /><circle cx="17" cy="10" r="2" /><path d="M3 20c.5-4 2.5-6 6-6s5.5 2 6 6m0-5c3 0 5 1.7 5 5" />'
  });

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const setStatus = (message, tone = "") => { status.textContent = message; status.className = `status-message ${tone}`.trim(); };

  const render = () => {
    const user = session.user;
    account.innerHTML = `<div><strong>${escapeHtml(user.email)}</strong><span>${user.isAdmin ? "Owner administrator" : "Verified member account"}</span></div>${user.isAdmin ? '<a class="button" href="admin/">Open Admin</a>' : ""}`;
    grid.innerHTML = session.resources.map((resource, index) => {
      const allowed = resource.accessLevel === "view" || resource.accessLevel === "edit";
      const pending = Boolean(resource.request);
      const badge = allowed ? `<span class="badge ${resource.accessLevel}">${resource.accessLevel} access</span>` : pending ? '<span class="badge pending">Request pending</span>' : '<span class="badge">Restricted</span>';
      const action = allowed
        ? `<a class="button" href="${resource.url}">Open ${escapeHtml(resource.name)}</a>`
        : pending
          ? '<button class="button secondary" disabled>Awaiting approval</button>'
          : `<button class="button secondary" data-request="${resource.key}">Request access</button>`;
      const icon = resourceIcons[resource.key] || resourceIcons.staff;
      return `<article class="resource-card ${requestedKey === resource.key ? "is-requested" : ""}" data-resource-card="${resource.key}"><div class="resource-card-top"><span class="resource-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></span><span class="resource-index">${String(index + 1).padStart(2, "0")}</span></div><h2>${escapeHtml(resource.name)}</h2><p>${escapeHtml(resource.description)}</p>${badge}<div class="card-actions">${action}</div></article>`;
    }).join("");

    if (requestedKey) {
      const target = session.resources.find((resource) => resource.key === requestedKey);
      if (target?.accessLevel === "none" && !target.request) openRequest(target);
    }
  };

  const openRequest = (resource) => {
    form.elements.resourceKey.value = resource.key;
    form.elements.requestedLevel.value = resource.requestLevel;
    form.elements.message.value = "";
    document.getElementById("requestTitle").textContent = `Request ${resource.name}`;
    dialog.showModal();
  };

  grid.addEventListener("click", (event) => {
    const key = event.target.closest("[data-request]")?.dataset.request;
    const resource = session?.resources.find((item) => item.key === key);
    if (resource) openRequest(resource);
  });

  form.addEventListener("submit", async (event) => {
    if (event.submitter?.value !== "submit") return;
    event.preventDefault();
    const button = document.getElementById("submitRequest");
    button.disabled = true;
    try {
      const response = await fetch("api/requests", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceKey: form.elements.resourceKey.value,
          requestedLevel: form.elements.requestedLevel.value,
          message: form.elements.message.value
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Request could not be sent");
      dialog.close();
      setStatus("Access request sent to the administrator.", "success");
      await loadSession();
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  async function loadSession() {
    const response = await fetch("api/session", { credentials: "same-origin", cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Private account could not be loaded");
    session = payload;
    render();
  }

  loadSession().catch((error) => {
    account.innerHTML = "<div><strong>Private workspace unavailable</strong><span>Try again after the configuration is complete.</span></div>";
    setStatus(error.message, "error");
  });
})();
