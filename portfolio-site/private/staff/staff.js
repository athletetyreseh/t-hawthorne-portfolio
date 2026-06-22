(() => {
  "use strict";
  const rows = document.getElementById("staffRows");
  const status = document.getElementById("staffStatus");
  const search = document.getElementById("staffSearch");
  const filter = document.getElementById("staffFilter");
  const dialog = document.getElementById("staffDialog");
  const form = document.getElementById("staffForm");
  const addButton = document.getElementById("addStaff");
  let staff = [];
  let accessLevel = "none";

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const setStatus = (message, tone = "") => { status.textContent = message; status.className = `status-message ${tone}`.trim(); };
  const formatDate = (value) => value ? new Date(value).toLocaleDateString() : "";

  const render = () => {
    const query = search.value.trim().toLowerCase();
    const statusFilter = filter.value;
    const visible = staff.filter((item) => {
      const haystack = [item.full_name, item.role_title, item.site, item.email, item.phone].join(" ").toLowerCase();
      return (!query || haystack.includes(query)) && (statusFilter === "all" || item.status === statusFilter);
    });
    if (!visible.length) {
      rows.innerHTML = '<tr><td colspan="6"><div class="empty-state">No matching staff records.</div></td></tr>';
      return;
    }
    rows.innerHTML = visible.map((item) => `<tr><td><span class="staff-name">${escapeHtml(item.full_name)}</span><small>${escapeHtml(item.role_title || "No role listed")}</small></td><td>${escapeHtml(item.site || "—")}</td><td>${escapeHtml(item.email || "—")}<small>${escapeHtml(item.phone || "")}</small></td><td><span class="badge ${item.status === "active" ? "view" : ""}">${escapeHtml(item.status)}</span></td><td>${formatDate(item.updated_at)}</td><td>${accessLevel === "edit" ? `<button class="button secondary" data-edit="${item.id}">Edit</button>` : ""}</td></tr>`).join("");
  };

  const openRecord = (record = null) => {
    form.reset();
    form.elements.id.value = record?.id || "";
    form.elements.fullName.value = record?.full_name || "";
    form.elements.roleTitle.value = record?.role_title || "";
    form.elements.site.value = record?.site || "";
    form.elements.email.value = record?.email || "";
    form.elements.phone.value = record?.phone || "";
    form.elements.status.value = record?.status || "active";
    form.elements.notes.value = record?.notes || "";
    document.getElementById("staffDialogTitle").textContent = record ? "Edit staff member" : "Add staff member";
    dialog.showModal();
  };

  addButton.addEventListener("click", () => openRecord());
  rows.addEventListener("click", (event) => {
    const id = Number(event.target.closest("[data-edit]")?.dataset.edit);
    const record = staff.find((item) => item.id === id);
    if (record) openRecord(record);
  });
  search.addEventListener("input", render);
  filter.addEventListener("change", render);

  form.addEventListener("submit", async (event) => {
    if (event.submitter?.value !== "save") return;
    event.preventDefault();
    const button = document.getElementById("saveStaff");
    button.disabled = true;
    const id = Number(form.elements.id.value);
    try {
      const response = await fetch("../api/staff", {
        method: id ? "PATCH" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: id || undefined,
          fullName: form.elements.fullName.value,
          roleTitle: form.elements.roleTitle.value,
          site: form.elements.site.value,
          email: form.elements.email.value,
          phone: form.elements.phone.value,
          status: form.elements.status.value,
          notes: form.elements.notes.value
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Staff record could not be saved");
      dialog.close();
      setStatus("Staff record saved.", "success");
      await loadStaff();
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  async function loadStaff() {
    const response = await fetch("../api/staff", { credentials: "same-origin", cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Staff directory could not be loaded");
    staff = payload.staff || [];
    accessLevel = payload.accessLevel;
    addButton.hidden = accessLevel !== "edit";
    render();
  }

  loadStaff().catch((error) => setStatus(error.message, "error"));
})();
