(() => {
  "use strict";

  const elements = {
    cards: document.getElementById("staffCards"),
    status: document.getElementById("staffStatus"),
    summary: document.getElementById("staffSummary"),
    cloud: document.getElementById("staffCloudState"),
    search: document.getElementById("staffSearch"),
    filter: document.getElementById("staffFilter"),
    occurrenceFilter: document.getElementById("occurrenceStaffFilter"),
    occurrenceRows: document.getElementById("occurrenceRows"),
    occurrenceTotal: document.getElementById("occurrenceTotal"),
    recipientList: document.getElementById("recipientList"),
    recipientCount: document.getElementById("recipientCount"),
    deliveryNote: document.getElementById("deliveryNote"),
    draftLinks: document.getElementById("draftLinks"),
    messageForm: document.getElementById("messageForm"),
    staffDialog: document.getElementById("staffDialog"),
    staffForm: document.getElementById("staffForm"),
    occurrenceDialog: document.getElementById("occurrenceDialog"),
    occurrenceForm: document.getElementById("occurrenceForm")
  };

  let staff = [];
  let occurrences = [];
  let accessLevel = "none";
  let emailDeliveryConfigured = false;
  const selected = new Set();

  const occurrenceLabels = Object.freeze({
    call_off: "Call off",
    no_call_no_show: "No call / no show",
    late: "Late arrival",
    left_early: "Left early",
    documentation: "Documentation only"
  });

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const setStatus = (message, tone = "") => {
    elements.status.textContent = message;
    elements.status.className = `staff-status ${tone}`.trim();
  };
  const formatDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString() : "Not recorded";
  const formatTimestamp = (value) => value ? new Date(value).toLocaleDateString() : "";
  const pointsForStaff = (staffId) => occurrences.filter((item) => item.staff_id === staffId).reduce((sum, item) => sum + Number(item.points || 0), 0);

  const credentialState = (value) => {
    if (!value) return { label: "Not recorded", className: "warning" };
    const today = new Date();
    const target = new Date(`${value}T12:00:00`);
    const days = Math.ceil((target - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
    if (days < 0) return { label: `${formatDate(value)} - expired`, className: "expired" };
    if (days <= 30) return { label: `${formatDate(value)} - ${days} days`, className: "warning" };
    return { label: formatDate(value), className: "" };
  };

  const visibleStaff = () => {
    const query = elements.search.value.trim().toLowerCase();
    const statusFilter = elements.filter.value;
    return staff.filter((item) => {
      const haystack = [item.full_name, item.role_title, item.site, item.email, item.phone].join(" ").toLowerCase();
      return (!query || haystack.includes(query)) && (statusFilter === "all" || item.status === statusFilter);
    });
  };

  const renderSummary = () => {
    const expiring = staff.filter((item) => [credentialState(item.guard_card_expiration).className, credentialState(item.cpr_expiration).className].some(Boolean)).length;
    const totalPoints = occurrences.reduce((sum, item) => sum + Number(item.points || 0), 0);
    const values = [staff.filter((item) => item.status === "active").length, selected.size, expiring, totalPoints];
    elements.summary.querySelectorAll("strong").forEach((node, index) => { node.textContent = String(values[index]); });
  };

  const renderRoster = () => {
    const visible = visibleStaff();
    if (!visible.length) {
      elements.cards.innerHTML = '<div class="staff-empty">No matching staff records.</div>';
      renderSummary();
      return;
    }
    elements.cards.innerHTML = visible.map((item) => {
      const guardCard = credentialState(item.guard_card_expiration);
      const cpr = credentialState(item.cpr_expiration);
      return `<article class="officer-card ${selected.has(item.id) ? "selected" : ""}" data-staff-card="${item.id}">
        <div class="officer-card-head"><input type="checkbox" data-select-staff="${item.id}" ${selected.has(item.id) ? "checked" : ""} aria-label="Select ${escapeHtml(item.full_name)}" /><div><strong>${escapeHtml(item.full_name)}</strong><span>${escapeHtml(item.role_title || "No role listed")} | ${escapeHtml(item.site || "No site listed")}</span></div><span class="officer-status">${escapeHtml(item.status)}</span></div>
        <div class="officer-contact"><div><span>Email</span>${item.email ? `<a href="mailto:${encodeURIComponent(item.email)}">${escapeHtml(item.email)}</a>` : "<strong>Not recorded</strong>"}</div><div><span>Phone</span>${item.phone ? `<a href="tel:${escapeHtml(item.phone)}">${escapeHtml(item.phone)}</a>` : "<strong>Not recorded</strong>"}</div></div>
        <div class="credential-grid"><div class="credential ${guardCard.className}"><span>Guard Card Expiration</span><strong>${escapeHtml(guardCard.label)}</strong></div><div class="credential ${cpr.className}"><span>CPR Expiration</span><strong>${escapeHtml(cpr.label)}</strong></div></div>
        <div class="officer-card-actions">${accessLevel === "edit" ? `<button class="wt-button" data-edit-staff="${item.id}">Edit</button><button class="wt-button" data-log-occurrence="${item.id}">Log Occurrence</button>` : ""}<span class="points-chip">${pointsForStaff(item.id)} points</span></div>
      </article>`;
    }).join("");
    renderSummary();
  };

  const renderOccurrenceOptions = () => {
    const current = elements.occurrenceFilter.value || "all";
    elements.occurrenceFilter.innerHTML = `<option value="all">All staff</option>${staff.map((item) => `<option value="${item.id}">${escapeHtml(item.full_name)}</option>`).join("")}`;
    elements.occurrenceFilter.value = staff.some((item) => String(item.id) === current) ? current : "all";
    elements.occurrenceForm.elements.staffId.innerHTML = staff.map((item) => `<option value="${item.id}">${escapeHtml(item.full_name)}</option>`).join("");
  };

  const filteredOccurrences = () => {
    const staffId = Number(elements.occurrenceFilter.value);
    return staffId > 0 ? occurrences.filter((item) => item.staff_id === staffId) : occurrences;
  };

  const renderOccurrences = () => {
    const visible = filteredOccurrences();
    const points = visible.reduce((sum, item) => sum + Number(item.points || 0), 0);
    elements.occurrenceTotal.textContent = `${points} occurrence point${points === 1 ? "" : "s"} in this view | ${visible.length} entr${visible.length === 1 ? "y" : "ies"}`;
    elements.occurrenceRows.innerHTML = visible.length ? visible.map((item) => `<tr><td><strong>${escapeHtml(item.full_name)}</strong></td><td>${formatDate(item.occurrence_date)}</td><td>${escapeHtml(occurrenceLabels[item.occurrence_type] || item.occurrence_type)}</td><td><span class="occurrence-points">${item.points}</span></td><td>${escapeHtml(item.notes || "")}</td><td>${accessLevel === "edit" ? `<button class="wt-button" data-edit-occurrence="${item.id}">Edit</button>` : ""}</td></tr>`).join("") : '<tr><td colspan="6">No occurrences in this view.</td></tr>';
    renderSummary();
  };

  const renderRecipients = () => {
    elements.recipientList.innerHTML = staff.length ? staff.map((item) => `<label class="recipient-row ${item.email ? "" : "no-email"}"><input type="checkbox" data-recipient="${item.id}" ${selected.has(item.id) ? "checked" : ""} ${item.email ? "" : "disabled"} /><span><strong>${escapeHtml(item.full_name)}</strong><span>${escapeHtml(item.email || "Email not recorded")}</span></span></label>`).join("") : '<div class="staff-empty">No staff records.</div>';
    const selectedWithEmail = staff.filter((item) => selected.has(item.id) && item.email);
    elements.recipientCount.textContent = `${selectedWithEmail.length} selected`;
    elements.deliveryNote.textContent = emailDeliveryConfigured
      ? "Direct delivery is configured. BCC hides recipient addresses; separate mode sends an individual message to each selected officer."
      : "Direct delivery needs an email provider key. BCC will open your mail app; separate mode will prepare one draft link per officer.";
    document.getElementById("sendMessage").textContent = emailDeliveryConfigured ? "Send Email" : "Prepare Email";
    renderSummary();
  };

  const syncSelection = (staffId, checked) => {
    if (checked) selected.add(staffId); else selected.delete(staffId);
    renderRoster();
    renderRecipients();
  };

  document.querySelectorAll("[data-staff-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-staff-tab]").forEach((item) => item.classList.toggle("active", item === button));
      document.querySelectorAll("[data-staff-panel]").forEach((panel) => {
        const active = panel.dataset.staffPanel === button.dataset.staffTab;
        panel.hidden = !active;
        panel.classList.toggle("active", active);
      });
    });
  });

  elements.cards.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-select-staff]");
    if (checkbox) syncSelection(Number(checkbox.dataset.selectStaff), checkbox.checked);
  });
  elements.recipientList.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-recipient]");
    if (checkbox) syncSelection(Number(checkbox.dataset.recipient), checkbox.checked);
  });
  elements.cards.addEventListener("click", (event) => {
    const editId = Number(event.target.closest("[data-edit-staff]")?.dataset.editStaff);
    const occurrenceId = Number(event.target.closest("[data-log-occurrence]")?.dataset.logOccurrence);
    if (editId) openStaff(staff.find((item) => item.id === editId));
    if (occurrenceId) openOccurrence(null, occurrenceId);
  });
  elements.occurrenceRows.addEventListener("click", (event) => {
    const id = Number(event.target.closest("[data-edit-occurrence]")?.dataset.editOccurrence);
    if (id) openOccurrence(occurrences.find((item) => item.id === id));
  });

  elements.search.addEventListener("input", renderRoster);
  elements.filter.addEventListener("change", renderRoster);
  elements.occurrenceFilter.addEventListener("change", renderOccurrences);
  document.getElementById("addStaff").addEventListener("click", () => openStaff());
  document.getElementById("addOccurrence").addEventListener("click", () => openOccurrence());
  document.getElementById("syncMaster").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await api("../api/staff-sync", "POST", {});
      setStatus(result.added ? `Added ${result.added} officer${result.added === 1 ? "" : "s"} from the master schedule.` : "Staff roster is already synchronized.", "success");
      await loadData();
    } catch (error) { setStatus(error.message, "error"); }
    finally { button.disabled = false; }
  });
  document.getElementById("selectActive").addEventListener("click", () => { staff.filter((item) => item.status === "active").forEach((item) => selected.add(item.id)); renderRoster(); renderRecipients(); });
  document.getElementById("selectWithEmail").addEventListener("click", () => { staff.filter((item) => item.email).forEach((item) => selected.add(item.id)); renderRoster(); renderRecipients(); });
  document.getElementById("clearSelection").addEventListener("click", () => { selected.clear(); renderRoster(); renderRecipients(); });

  const openStaff = (record = null) => {
    elements.staffForm.reset();
    elements.staffForm.elements.id.value = record?.id || "";
    elements.staffForm.elements.fullName.value = record?.full_name || "";
    elements.staffForm.elements.roleTitle.value = record?.role_title || "";
    elements.staffForm.elements.site.value = record?.site || "";
    elements.staffForm.elements.email.value = record?.email || "";
    elements.staffForm.elements.phone.value = record?.phone || "";
    elements.staffForm.elements.guardCardExpiration.value = record?.guard_card_expiration || "";
    elements.staffForm.elements.cprExpiration.value = record?.cpr_expiration || "";
    elements.staffForm.elements.status.value = record?.status || "active";
    elements.staffForm.elements.notes.value = record?.notes || "";
    document.getElementById("staffDialogTitle").textContent = record ? "Edit officer" : "Add officer";
    document.getElementById("deleteStaff").hidden = !record;
    elements.staffDialog.showModal();
  };

  elements.staffForm.addEventListener("submit", async (event) => {
    if (event.submitter?.value !== "save") return;
    event.preventDefault();
    const button = document.getElementById("saveStaff");
    button.disabled = true;
    const id = Number(elements.staffForm.elements.id.value);
    try {
      await api("../api/staff", id ? "PATCH" : "POST", {
        id: id || undefined,
        fullName: elements.staffForm.elements.fullName.value,
        roleTitle: elements.staffForm.elements.roleTitle.value,
        site: elements.staffForm.elements.site.value,
        email: elements.staffForm.elements.email.value,
        phone: elements.staffForm.elements.phone.value,
        guardCardExpiration: elements.staffForm.elements.guardCardExpiration.value,
        cprExpiration: elements.staffForm.elements.cprExpiration.value,
        status: elements.staffForm.elements.status.value,
        notes: elements.staffForm.elements.notes.value
      });
      elements.staffDialog.close();
      setStatus("Officer record saved.", "success");
      await loadData();
    } catch (error) { setStatus(error.message, "error"); }
    finally { button.disabled = false; }
  });

  document.getElementById("deleteStaff").addEventListener("click", async () => {
    const id = Number(elements.staffForm.elements.id.value);
    const record = staff.find((item) => item.id === id);
    if (!record || !confirm(`Remove ${record.full_name}? This permanently deletes the officer and all occurrence history.`)) return;
    try {
      await api("../api/staff", "DELETE", { id });
      selected.delete(id);
      elements.staffDialog.close();
      setStatus("Officer and occurrence history removed.", "success");
      await loadData();
    } catch (error) { setStatus(error.message, "error"); }
  });

  const openOccurrence = (record = null, staffId = 0) => {
    elements.occurrenceForm.reset();
    elements.occurrenceForm.elements.id.value = record?.id || "";
    const preferredStaff = record?.staff_id || staffId || Number(elements.occurrenceFilter.value) || staff[0]?.id;
    elements.occurrenceForm.elements.staffId.value = preferredStaff || "";
    elements.occurrenceForm.elements.occurrenceDate.value = record?.occurrence_date || new Date().toISOString().slice(0, 10);
    elements.occurrenceForm.elements.occurrenceType.value = record?.occurrence_type || "call_off";
    elements.occurrenceForm.elements.notes.value = record?.notes || "";
    document.getElementById("occurrenceDialogTitle").textContent = record ? "Edit occurrence" : "Log occurrence";
    document.getElementById("deleteOccurrence").hidden = !record;
    elements.occurrenceDialog.showModal();
  };

  elements.occurrenceForm.addEventListener("submit", async (event) => {
    if (event.submitter?.value !== "save") return;
    event.preventDefault();
    const button = document.getElementById("saveOccurrence");
    button.disabled = true;
    const id = Number(elements.occurrenceForm.elements.id.value);
    try {
      await api("../api/occurrences", id ? "PATCH" : "POST", {
        id: id || undefined,
        staffId: Number(elements.occurrenceForm.elements.staffId.value),
        occurrenceDate: elements.occurrenceForm.elements.occurrenceDate.value,
        occurrenceType: elements.occurrenceForm.elements.occurrenceType.value,
        notes: elements.occurrenceForm.elements.notes.value
      });
      elements.occurrenceDialog.close();
      setStatus("Occurrence saved with the required point value.", "success");
      await loadData();
    } catch (error) { setStatus(error.message, "error"); }
    finally { button.disabled = false; }
  });

  document.getElementById("deleteOccurrence").addEventListener("click", async () => {
    const id = Number(elements.occurrenceForm.elements.id.value);
    if (!id || !confirm("Delete this occurrence entry? This changes the officer's point total.")) return;
    try {
      await api("../api/occurrences", "DELETE", { id });
      elements.occurrenceDialog.close();
      setStatus("Occurrence deleted.", "success");
      await loadData();
    } catch (error) { setStatus(error.message, "error"); }
  });

  elements.messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    elements.draftLinks.innerHTML = "";
    const recipients = staff.filter((item) => selected.has(item.id) && item.email);
    const mode = new FormData(elements.messageForm).get("mode");
    const subject = elements.messageForm.elements.subject.value.trim();
    const body = elements.messageForm.elements.body.value.trim();
    if (!recipients.length) return setStatus("Select at least one officer with an email address.", "error");
    if (!subject || !body) return setStatus("Subject and message body are required.", "error");

    if (!emailDeliveryConfigured) {
      if (mode === "bcc") {
        location.href = `mailto:?bcc=${encodeURIComponent(recipients.map((item) => item.email).join(","))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        setStatus("Opened a BCC draft in your mail app.", "success");
      } else {
        elements.draftLinks.innerHTML = recipients.map((item) => `<a href="mailto:${encodeURIComponent(item.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}">Open draft for ${escapeHtml(item.full_name)}</a>`).join("");
        setStatus("Separate drafts are ready below.", "success");
      }
      return;
    }

    if (!confirm(`Send ${mode === "bcc" ? "one BCC message" : `${recipients.length} separate messages`} to ${recipients.length} selected officer${recipients.length === 1 ? "" : "s"}?`)) return;
    const button = document.getElementById("sendMessage");
    button.disabled = true;
    try {
      const result = await api("../api/staff-email", "POST", { staffIds: recipients.map((item) => item.id), mode, subject, body });
      setStatus(`Email sent to ${result.recipientCount} officer${result.recipientCount === 1 ? "" : "s"}.`, "success");
    } catch (error) { setStatus(error.message, "error"); }
    finally { button.disabled = false; }
  });

  document.getElementById("exportRoster").addEventListener("click", () => {
    const rows = staff.map((item) => [item.full_name, item.role_title, item.site, item.email, item.phone, item.guard_card_expiration, item.cpr_expiration, item.status, item.notes, item.updated_at]);
    downloadXlsx("staff-master-roster.xlsx", "Staff Roster", [["Name", "Role", "Site", "Email", "Phone", "Guard Card Expiration", "CPR Expiration", "Status", "Notes", "Updated"], ...rows]);
  });
  document.getElementById("exportOccurrenceView").addEventListener("click", () => exportOccurrences(filteredOccurrences(), "staff-occurrences-current.xlsx"));
  document.getElementById("exportAllOccurrences").addEventListener("click", () => exportOccurrences(occurrences, "staff-occurrences-all.xlsx"));

  const exportOccurrences = (records, filename) => {
    const rows = records.map((item) => [item.full_name, item.occurrence_date, occurrenceLabels[item.occurrence_type] || item.occurrence_type, item.points, item.notes, item.updated_at]);
    downloadXlsx(filename, "Occurrences", [["Officer", "Occurrence Date", "Type", "Points", "Notes", "Updated"], ...rows]);
  };

  async function api(url, method, body) {
    const response = await fetch(url, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Request failed");
    return payload;
  }

  async function loadData() {
    elements.cloud.textContent = "Loading cloud data";
    const [staffResponse, occurrenceResponse] = await Promise.all([
      fetch("../api/staff", { credentials: "same-origin", cache: "no-store" }),
      fetch("../api/occurrences", { credentials: "same-origin", cache: "no-store" })
    ]);
    const [staffPayload, occurrencePayload] = await Promise.all([staffResponse.json(), occurrenceResponse.json()]);
    if (!staffResponse.ok) throw new Error(staffPayload.error || "Staff roster could not be loaded");
    if (!occurrenceResponse.ok) throw new Error(occurrencePayload.error || "Occurrences could not be loaded");
    staff = staffPayload.staff || [];
    occurrences = occurrencePayload.occurrences || [];
    accessLevel = staffPayload.accessLevel;
    emailDeliveryConfigured = Boolean(staffPayload.emailDeliveryConfigured);
    [...selected].forEach((id) => { if (!staff.some((item) => item.id === id)) selected.delete(id); });
    document.getElementById("addStaff").hidden = accessLevel !== "edit";
    document.getElementById("addOccurrence").hidden = accessLevel !== "edit";
    document.getElementById("syncMaster").hidden = accessLevel !== "edit";
    renderOccurrenceOptions();
    renderRoster();
    renderOccurrences();
    renderRecipients();
    elements.cloud.textContent = "Cloud data current";
  }

  // Minimal standards-compliant XLSX writer using uncompressed ZIP entries.
  const textEncoder = new TextEncoder();
  const xml = (value) => String(value ?? "").replace(/^[=+\-@]/, "'$&").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const columnName = (index) => {
    let name = "";
    for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
    return name;
  };
  const crcTable = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    bytes.forEach((byte) => { crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8); });
    return (crc ^ 0xffffffff) >>> 0;
  };
  const write16 = (view, offset, value) => view.setUint16(offset, value, true);
  const write32 = (view, offset, value) => view.setUint32(offset, value >>> 0, true);
  const joinBytes = (parts) => {
    const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    parts.forEach((part) => { output.set(part, offset); offset += part.length; });
    return output;
  };
  const makeZip = (files) => {
    const locals = [];
    const centrals = [];
    let offset = 0;
    files.forEach(({ name, content }) => {
      const nameBytes = textEncoder.encode(name);
      const data = textEncoder.encode(content);
      const checksum = crc32(data);
      const local = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(local.buffer);
      write32(localView, 0, 0x04034b50); write16(localView, 4, 20); write16(localView, 6, 0); write16(localView, 8, 0); write16(localView, 10, 0); write16(localView, 12, 0);
      write32(localView, 14, checksum); write32(localView, 18, data.length); write32(localView, 22, data.length); write16(localView, 26, nameBytes.length); write16(localView, 28, 0); local.set(nameBytes, 30);
      const central = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(central.buffer);
      write32(centralView, 0, 0x02014b50); write16(centralView, 4, 20); write16(centralView, 6, 20); write16(centralView, 8, 0); write16(centralView, 10, 0); write16(centralView, 12, 0); write16(centralView, 14, 0);
      write32(centralView, 16, checksum); write32(centralView, 20, data.length); write32(centralView, 24, data.length); write16(centralView, 28, nameBytes.length); write16(centralView, 30, 0); write16(centralView, 32, 0); write16(centralView, 34, 0); write16(centralView, 36, 0); write32(centralView, 38, 0); write32(centralView, 42, offset); central.set(nameBytes, 46);
      locals.push(local, data); centrals.push(central); offset += local.length + data.length;
    });
    const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    write32(endView, 0, 0x06054b50); write16(endView, 4, 0); write16(endView, 6, 0); write16(endView, 8, files.length); write16(endView, 10, files.length); write32(endView, 12, centralSize); write32(endView, 16, offset); write16(endView, 20, 0);
    return joinBytes([...locals, ...centrals, end]);
  };

  function downloadXlsx(filename, sheetName, rows) {
    const sheetRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, columnIndex) => `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(cell)}</t></is></c>`).join("")}</row>`).join("");
    const files = [
      { name: "[Content_Types].xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
      { name: "_rels/.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: "xl/worksheets/sheet1.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>` }
    ];
    const url = URL.createObjectURL(new Blob([makeZip(files)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const link = document.createElement("a");
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`${filename} exported.`, "success");
  }

  loadData().catch((error) => {
    elements.cloud.textContent = "Cloud load failed";
    setStatus(error.message, "error");
  });
})();
