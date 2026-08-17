(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const state = { records: new Map(), photos: [], history: [], devices: [], activeDay: null };
  const minutes = (value) => { const [h, m] = String(value || "00:00").split(":").map(Number); return h * 60 + m; };
  const time = (value) => `${String(Math.floor(Number(value || 0) / 60)).padStart(2, "0")}:${String(Number(value || 0) % 60).padStart(2, "0")}`;
  const keyFor = (type, id) => `${type}:${id}`;
  const lines = (value) => String(value || "").split("\n").map((item) => item.trim()).filter(Boolean);
  const colorToHex = (argb) => `#${(Number(argb || 0xff6d36d8) & 0xffffff).toString(16).padStart(6, "0")}`;
  const hexToArgb = (hex) => (0xff000000 | Number.parseInt(String(hex).replace("#", ""), 16)) >>> 0;
  let messageTimer = null;

  const message = (text, error = false) => {
    clearTimeout(messageTimer); const el = $("message"); el.textContent = text; el.className = `message show${error ? " error" : ""}`;
    messageTimer = setTimeout(() => { el.className = "message"; }, 4500);
  };
  const request = async (url, options = {}) => {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options });
    const payload = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status})`);
    return payload;
  };
  const record = (type, id) => state.records.get(keyFor(type, id));

  const defaultEvent = () => ({ description: "New Event", symbol: "work", color: 0xff6d36d8, start: 480, end: 540, sound: "Morning bell", soundIsAssigned: true, speakDescription: true, spokenText: "", speechVoice: "Default", eventAlarm: true, alarmOutput: "auto", alarmLeadSeconds: 0, photoCount: 0, photoLabels: [], checklist: [], completedChecklist: [], notes: "", deferredChecklist: [], recurrenceRule: "none", recurrenceInterval: 1, recurrenceEndKey: "", recurrenceWeekday: 0, recurrenceOrdinal: 0 });
  const addEventCard = (event = defaultEvent()) => {
    const fragment = $("eventTemplate").content.cloneNode(true); const card = fragment.querySelector(".event-card"); card._event = structuredClone(event);
    card.querySelector('[data-field="description"]').value = event.description || "";
    card.querySelector('[data-field="start"]').value = time(event.start);
    card.querySelector('[data-field="end"]').value = time(event.end);
    card.querySelector('[data-field="color"]').value = colorToHex(event.color);
    card.querySelector('[data-field="recurrenceRule"]').value = event.recurrenceRule || "none";
    card.querySelector('[data-field="eventAlarm"]').checked = event.eventAlarm !== false;
    card.querySelector('[data-field="speakDescription"]').checked = event.speakDescription !== false;
    card.querySelector('[data-field="checklist"]').value = (event.checklist || []).join("\n");
    card.querySelector('[data-field="notes"]').value = event.notes || "";
    card.querySelector("[data-remove]").addEventListener("click", () => card.remove());
    $("eventList").append(card);
  };
  const collectEvents = () => [...$("eventList").querySelectorAll(".event-card")].map((card) => ({
    ...card._event,
    description: card.querySelector('[data-field="description"]').value.trim() || "New Event",
    start: minutes(card.querySelector('[data-field="start"]').value),
    end: minutes(card.querySelector('[data-field="end"]').value),
    color: hexToArgb(card.querySelector('[data-field="color"]').value),
    recurrenceRule: card.querySelector('[data-field="recurrenceRule"]').value,
    eventAlarm: card.querySelector('[data-field="eventAlarm"]').checked,
    speakDescription: card.querySelector('[data-field="speakDescription"]').checked,
    checklist: lines(card.querySelector('[data-field="checklist"]').value),
    notes: card.querySelector('[data-field="notes"]').value
  }));

  const openDay = (date) => {
    state.activeDay = date; $("dayDate").value = date; const existing = record("day", date); const plan = existing?.payload || {};
    $("dayStart").value = time(plan.dayStart ?? 345); $("dayEnd").value = time(plan.dayEnd ?? 1320); $("dayWake").value = time(plan.draft?.wakeUpTime ?? 345); $("dayWakeAlarm").checked = plan.draft?.createWakeUpAlarm !== false; $("dayTasks").value = (plan.dayTasks || []).join("\n"); $("dayJson").value = JSON.stringify(plan, null, 2); $("eventList").innerHTML = "";
    (plan.events || []).forEach(addEventCard); if (!(plan.events || []).length) addEventCard();
  };
  const today = () => { const value = new Date(); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; };

  const saveRecord = async (type, id, payload) => {
    const existing = record(type, id); const body = { type, id, payload, baseVersion: existing?.version || 0, updatedAt: new Date().toISOString() };
    const result = await request("api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    state.records.set(keyFor(type, id), result.record); return result.record;
  };

  const saveDay = async () => {
    const date = $("dayDate").value || today(); const existing = record("day", date)?.payload || {}; const raw = $("dayJson").value.trim() ? JSON.parse($("dayJson").value) : {};
    const draft = { selectedDate: date, wakeUpTime: minutes($("dayWake").value), createWakeUpAlarm: $("dayWakeAlarm").checked, alarmVoice: null, alarmSound: "Morning bell", alarmVolume: 80, alarmThemeColor: 4286324223, alarmOutput: "auto", ...(existing.draft || {}), ...(raw.draft || {}) };
    draft.selectedDate = date; draft.wakeUpTime = minutes($("dayWake").value); draft.createWakeUpAlarm = $("dayWakeAlarm").checked;
    const payload = { ...existing, ...raw, date, dayStart: minutes($("dayStart").value), dayEnd: minutes($("dayEnd").value), events: collectEvents(), dayTasks: lines($("dayTasks").value), completedDayTasks: raw.completedDayTasks || existing.completedDayTasks || [], updatedAt: new Date().toISOString(), draft };
    await saveRecord("day", date, payload); message("Day saved to the private cloud."); await loadAll(); openDay(date);
  };
  const saveDayJson = async () => {
    const date = $("dayDate").value || today(); const payload = JSON.parse($("dayJson").value); payload.date = date;
    await saveRecord("day", date, payload); message("Complete day data saved to the private cloud."); await loadAll(); openDay(date);
  };
  const deleteDay = async () => {
    const date = $("dayDate").value; const existing = record("day", date); if (!existing || !confirm(`Delete the plan for ${date}? A restore copy will remain in cloud history.`)) return;
    await request("api/state", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "day", id: date, baseVersion: existing.version }) });
    message("Day deleted. Restore history was retained."); await loadAll(); openDay(today());
  };

  const renderAdvanced = () => {
    const specs = [["templates", "main", "Templates", []], ["saved_events", "main", "Reusable events", []], ["preferences", "main", "Preferences", { themePreference: "auto", timelinePaletteId: "aurora" }]];
    $("advancedRecords").innerHTML = "";
    specs.forEach(([type, id, title, fallback]) => {
      const card = document.createElement("article"); card.className = "advanced-card"; const value = record(type, id)?.payload ?? fallback;
      card.innerHTML = `<strong>${title}</strong><textarea spellcheck="false"></textarea><button type="button">Save ${title.toLowerCase()}</button>`; card.querySelector("textarea").value = JSON.stringify(value, null, 2);
      card.querySelector("button").addEventListener("click", async () => { try { await saveRecord(type, id, JSON.parse(card.querySelector("textarea").value)); message(`${title} saved.`); await loadAll(); } catch (error) { message(error.message, true); } });
      $("advancedRecords").append(card);
    });
  };
  const renderDevices = () => {
    $("deviceCount").textContent = state.devices.filter((item) => !item.revoked_at).length;
    $("deviceList").innerHTML = state.devices.length ? state.devices.map((device) => `<article class="stack-item"><span><strong>${device.device_name}</strong><small>Last seen ${new Date(device.last_seen_at).toLocaleString()}${device.revoked_at ? " · revoked" : ""}</small></span>${device.revoked_at ? "" : `<button class="danger subtle" data-revoke="${device.device_id}">Revoke</button>`}</article>`).join("") : '<p class="helper">No Android device is connected yet.</p>';
  };
  const renderPhotos = () => {
    $("photoCount").textContent = state.photos.length;
    $("photoGrid").innerHTML = state.photos.length ? state.photos.map((photo) => `<figure><img loading="lazy" src="api/photos/${encodeURIComponent(photo.photo_id)}" alt="${String(photo.file_name).replace(/"/g, "&quot;")}" /><figcaption>${photo.file_name}</figcaption></figure>`).join("") : '<p class="helper">Photos will appear after the Android app completes its first sync.</p>';
  };
  const renderHistory = () => { $("historyList").innerHTML = state.history.length ? state.history.map((item) => `<article class="stack-item"><span><strong>${item.record_type} · ${item.record_id}</strong><small>${item.outcome} · ${new Date(item.archived_at).toLocaleString()}</small></span><small>v${item.version}</small></article>`).join("") : '<p class="helper">No replaced or conflicting versions yet.</p>'; };
  const renderMetrics = () => {
    const days = [...state.records.values()].filter((item) => item.type === "day" && !item.deletedAt); $("planCount").textContent = days.length; $("eventCount").textContent = days.reduce((sum, item) => sum + (item.payload?.events?.length || 0), 0);
  };
  const loadAll = async () => {
    $("syncStatus").textContent = "Loading cloud state…"; $("syncStatus").className = "sync-pill";
    const [cloud, devices, health] = await Promise.all([request("api/state"), request("api/devices"), request("api/health")]); state.records.clear(); cloud.records.forEach((item) => state.records.set(keyFor(item.type, item.id), item)); state.photos = cloud.photos || []; state.history = cloud.history || []; state.devices = devices.devices || [];
    renderMetrics(); renderDevices(); renderPhotos(); renderAdvanced(); renderHistory(); $("syncStatus").textContent = `Cloud synced · r${cloud.cursor} · ${health.photoStorage === "ready" ? "photo storage ready" : "photo storage unavailable"}`; $("syncStatus").className = "sync-pill saved";
  };

  $("addEvent").addEventListener("click", () => addEventCard()); $("saveDay").addEventListener("click", () => saveDay().catch((error) => message(error.message, true))); $("saveDayJson").addEventListener("click", () => saveDayJson().catch((error) => message(error.message, true))); $("deleteDay").addEventListener("click", () => deleteDay().catch((error) => message(error.message, true))); $("dayDate").addEventListener("change", (event) => openDay(event.target.value));
  $("pairForm").addEventListener("submit", async (event) => { event.preventDefault(); const button = event.submitter; button.disabled = true; try { const result = await request("api/pair/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userCode: event.currentTarget.elements.userCode.value }) }); message(`${result.deviceName} approved. Return to the app to finish connecting.`); event.currentTarget.reset(); } catch (error) { message(error.message, true); } finally { button.disabled = false; } });
  $("deviceList").addEventListener("click", async (event) => { const id = event.target.closest("[data-revoke]")?.dataset.revoke; if (!id || !confirm("Revoke this phone's cloud access? Local offline data will remain on the phone.")) return; try { await request("api/devices", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: id }) }); message("Device access revoked."); await loadAll(); } catch (error) { message(error.message, true); } });
  const requestedDate = new URLSearchParams(location.search).get("date") || today(); loadAll().then(() => openDay(requestedDate)).catch((error) => { $("syncStatus").textContent = error.message; $("syncStatus").className = "sync-pill error"; message(error.message, true); openDay(requestedDate); });
})();
