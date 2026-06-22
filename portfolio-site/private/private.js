(() => {
  "use strict";
  const grid = document.getElementById("resourceGrid");
  const account = document.getElementById("accountStrip");
  const status = document.getElementById("statusMessage");
  const dialog = document.getElementById("requestDialog");
  const form = document.getElementById("requestForm");
  const requestedKey = new URLSearchParams(location.search).get("request");
  let session = null;

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
        ? `<a class="button" href="${resource.url}">Open resource</a>`
        : pending
          ? '<button class="button secondary" disabled>Awaiting approval</button>'
          : `<button class="button secondary" data-request="${resource.key}">Request access</button>`;
      return `<article class="resource-card ${requestedKey === resource.key ? "is-requested" : ""}" data-resource-card="${resource.key}"><span class="resource-index">${String(index + 1).padStart(2, "0")}</span><h2>${escapeHtml(resource.name)}</h2><p>${escapeHtml(resource.description)}</p>${badge}<div class="card-actions">${action}</div></article>`;
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
