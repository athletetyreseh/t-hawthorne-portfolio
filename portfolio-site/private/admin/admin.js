(() => {
  "use strict";
  const userRows = document.getElementById("userRows");
  const requestPanel = document.getElementById("requestPanel");
  const status = document.getElementById("adminStatus");
  let data = null;
  let requests = [];

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const formatDate = (value) => value ? new Date(value).toLocaleString() : "Never";
  const setStatus = (message, tone = "") => { status.textContent = message; status.className = `status-message ${tone}`.trim(); };

  const permissionFor = (email, resourceKey) => data.permissions.find((item) => item.user_email === email && item.resource_key === resourceKey)?.access_level || "none";

  const renderRequests = () => {
    const pending = requests.filter((request) => request.status === "pending");
    if (!pending.length) {
      requestPanel.innerHTML = '<div class="empty-state">No pending access requests.</div>';
      return;
    }
    requestPanel.innerHTML = `<div class="table-scroll"><table><thead><tr><th>User</th><th>Resource</th><th>Request</th><th>Action</th></tr></thead><tbody>${pending.map((request) => `<tr><td><strong>${escapeHtml(request.user_email)}</strong><small>${formatDate(request.requested_at)}</small></td><td>${escapeHtml(data.resources[request.resource_key]?.name || request.resource_key)}</td><td><span class="badge pending">${escapeHtml(request.requested_level)}</span><small>${escapeHtml(request.message || "No note provided")}</small></td><td><div class="card-actions"><button class="button" data-resolve="${request.id}" data-decision="approved">Approve</button><button class="button danger" data-resolve="${request.id}" data-decision="denied">Deny</button></div></td></tr>`).join("")}</tbody></table></div>`;
  };

  const renderUsers = () => {
    userRows.innerHTML = data.users.map((user) => {
      const owner = user.role === "owner";
      const controls = Object.entries(data.resources).map(([key, resource]) => {
        const selected = owner ? "edit" : permissionFor(user.email, key);
        return `<label>${escapeHtml(resource.name)}<select class="table-control" data-email="${escapeHtml(user.email)}" data-resource="${key}" ${owner ? "disabled" : ""}><option value="none" ${selected === "none" ? "selected" : ""}>No access</option><option value="view" ${selected === "view" ? "selected" : ""}>View</option><option value="edit" ${selected === "edit" ? "selected" : ""}>Edit</option></select></label>`;
      }).join("");
      return `<tr><td><strong>${escapeHtml(user.email)}</strong><small>${owner ? "Owner administrator" : "Member"}</small></td><td>${formatDate(user.last_seen_at)}</td><td><div class="permission-grid">${controls}</div></td></tr>`;
    }).join("");
  };

  async function postAction(body) {
    const response = await fetch("../api/admin/access", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Administrator action failed");
    return payload;
  }

  userRows.addEventListener("change", async (event) => {
    const select = event.target.closest("[data-email][data-resource]");
    if (!select) return;
    select.disabled = true;
    try {
      await postAction({ action: "set-permission", email: select.dataset.email, resourceKey: select.dataset.resource, accessLevel: select.value });
      setStatus(`Updated ${select.dataset.email}.`, "success");
      await loadAdmin();
    } catch (error) {
      setStatus(error.message, "error");
      select.disabled = false;
    }
  });

  requestPanel.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-resolve]");
    if (!button) return;
    button.disabled = true;
    try {
      await postAction({ action: "resolve-request", requestId: Number(button.dataset.resolve), decision: button.dataset.decision });
      setStatus(`Request ${button.dataset.decision}.`, "success");
      await loadAdmin();
    } catch (error) {
      setStatus(error.message, "error");
      button.disabled = false;
    }
  });

  async function loadAdmin() {
    const [accessResponse, requestResponse] = await Promise.all([
      fetch("../api/admin/access", { credentials: "same-origin", cache: "no-store" }),
      fetch("../api/requests", { credentials: "same-origin", cache: "no-store" })
    ]);
    const [accessPayload, requestPayload] = await Promise.all([accessResponse.json(), requestResponse.json()]);
    if (!accessResponse.ok) throw new Error(accessPayload.error || "Access administration could not be loaded");
    if (!requestResponse.ok) throw new Error(requestPayload.error || "Requests could not be loaded");
    data = accessPayload;
    requests = requestPayload.requests || [];
    renderRequests();
    renderUsers();
  }

  document.getElementById("refreshAdmin").addEventListener("click", () => loadAdmin().catch((error) => setStatus(error.message, "error")));
  loadAdmin().catch((error) => setStatus(error.message, "error"));
})();
