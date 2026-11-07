const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  print: '<path d="M6 9V3h12v6M6 18H3V9h18v9h-3"/><path d="M6 14h12v7H6zM17 12h1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  qr: '<path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h3v3h-6zM15 12h6m-9 3v6"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  back: '<path d="M19 12H5m6 6-6-6 6-6"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M6 15h5m3-5h4m-4 4h4"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="3"/>',
  check: '<path d="m5 12 4 4L19 6"/>'
};
const icon = name => '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + icons[name] + '</svg>';
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const main = document.querySelector("main");
const basePath = "__BADGE_BASE_PATH__";
const local = route => basePath + route;
const path = location.pathname.slice(basePath.length).replace(/\/$/, "") || "/";
const nav = (href, label, glyph) => '<a href="' + local(href) + '"' + ((path === href || (href === "/" && path.startsWith("/b/"))) ? ' aria-current="page"' : "") + '>' + icon(glyph) + label + '</a>';
document.querySelector("header").innerHTML = '<div class="head-inner"><a class="brand" href="' + local("/") + '"><img class="brand-logo" src="' + local("/logo/ipsa.png") + '" alt="IPSA Security Services"><span class="brand-title">Badge Desk</span></a><nav aria-label="Main navigation">' + nav("/", "Badge roster", "grid") + nav("/history", "Activity log", "clock") + nav("/sheets", "Print labels", "print") + '</nav></div>';

let badges, origin;
const logoNames = {wab:"Western Alliance Bank", amazon:"Amazon", shred:"Secure Shred", ups:"UPS", fedex:"FedEx"};
const logos = badge => badge.logos.length
  ? badge.logos.map(logo => '<img class="logo ' + logo + '" src="' + local("/logo/") + logo + '.png" alt="' + logoNames[logo] + '">').join("")
  : '<span class="misc-logo">' + icon("card") + '<b>Other Vendor</b></span>';
const qr = badge => '<img class="qr-image" src="' + local("/qr/") + badge.slug + '.svg" alt="Checkout QR code for ' + badge.code + '">';
const link = badge => origin + "/b/" + badge.slug;
const wabCalls = '<span>847-293-3838</span><span>602-386-5500</span>';
const date = new Intl.DateTimeFormat("en-US", {dateStyle:"medium",timeStyle:"short",timeZone:"America/Phoenix"});
const when = iso => date.format(new Date(iso)) + " MST";

async function api(url, options) {
  const response = await fetch(local(url), {cache:"no-store", ...options});
  const data = await response.json().catch(() => null);
  if (!response.ok || (data === null && !url.startsWith("/api/badge/"))) {
    throw new Error(data?.error || "Could not reach the badge desk. Please try again.");
  }
  return data;
}

function intro(kicker, title, copy, action = "") {
  return '<div class="intro"><div><div class="eyebrow">' + kicker + '</div><h1>' + title + '</h1><p>' + copy + '</p></div>' + action + '</div>';
}
function checkoutLink(badge) {
  return '<a class="badge-tile" href="' + local("/b/") + badge.slug + '"><span class="tile-main"><strong>' + badge.code + '</strong><span class="tile-status" data-badge="' + badge.slug + '">Checking…</span></span>' + icon("arrow") + '</a>';
}
async function roster() {
  const groups = Object.groupBy(badges, badge => badge.group);
  main.classList.add("roster-page");
  main.innerHTML = '<section class="roster-summary" aria-label="Badge status"><div><span>Total badges</span><strong>' + badges.length + '</strong></div><div><span>Available</span><strong id="available">—</strong></div><div><span>Checked out</span><strong id="out">—</strong></div></section>' +
    '<section class="roster-list" aria-label="Badges by company"><div class="roster-list-title"><h2>Badges by company</h2><span>SELECT A BADGE</span></div>' +
    Object.values(groups).map(group => '<article class="roster-group"><div class="group-logo theme-' + group[0].theme + '">' + logos(group[0]) + '</div><div class="group-content"><h3>' + group[0].group + ' <span>' + group.length + ' badges</span></h3><div class="tile-grid">' + group.map(checkoutLink).join("") + '</div></div></article>').join("") + '</section>';
  try {
    const active = new Set(await api("/api/status"));
    document.querySelector("#available").textContent = badges.length - active.size;
    document.querySelector("#out").textContent = active.size;
    document.querySelectorAll("[data-badge]").forEach(tile => {
      const checkedOut = active.has(tile.dataset.badge);
      tile.textContent = checkedOut ? "Checked out" : "Available";
      tile.classList.add(checkedOut ? "out" : "available");
    });
  } catch {
    document.querySelectorAll("[data-badge]").forEach(tile => tile.textContent = "Status unavailable");
  }
}
function label(badge) {
  return '<article class="badge-label"><div class="label-top label-' + badge.theme + '"><div class="label-logo">' + logos(badge) + '</div><div class="label-number"><span>BADGE</span><strong>' + String(badge.number).padStart(2,"0") + '</strong></div></div>' +
    '<div class="label-body">' + qr(badge) + '<div class="label-info"><strong>' + badge.code + '</strong><span>SCAN TO CHECK OUT</span>' +
    (badge.theme === "bank" ? '<div class="label-call"><div class="call-instruction"><strong>CALL</strong> BEFORE SENDING UP</div>' + wabCalls + '</div>' : '') + '</div></div></article>';
}
function printSheets() {
  main.classList.add("sheets-main");
  main.innerHTML = '<div class="screen-only"><div class="sheet-title"><h1>Print sheets</h1><button class="btn primary" id="print">' + icon("print") + ' Print</button></div>' +
    '<div class="sheet-controls"><label for="group">Badges</label><select id="group"><option value="">All badges (' + badges.length + ')</option>' +
    [...new Set(badges.map(badge => badge.group))].map(group => '<option>' + group + '</option>').join("") + '</select><span>US Letter · Color · 100% scale</span></div></div><div id="sheets"></div>';
  const group = document.querySelector("#group");
  const update = () => {
    const selection = badges.filter(badge => !group.value || group.value === badge.group);
    const pages = [];
    for (let index = 0; index < selection.length; index += 8) pages.push(selection.slice(index, index + 8));
    document.querySelector("#sheets").innerHTML = pages.map((page, i) => '<section class="paper"><div class="paper-head"><div><strong>Visitor badge labels</strong><span>' + (group.value || "All badges") + ' · Sheet ' + (i + 1) + ' of ' + pages.length + '</span></div><div class="ruler"><i></i><span>1 inch</span></div></div><div class="print-grid">' + page.map(label).join("") + '</div></section>').join("");
  };
  group.onchange = update;
  update();
  const button = document.querySelector("#print");
  button.onclick = async () => {
    button.disabled = true;
    try {
      await Promise.all([...document.querySelectorAll("#sheets img")].map(image => image.decode()));
      window.print();
    } catch {
      alert("A badge image failed to load. Reload the page before printing.");
    } finally {
      button.disabled = false;
    }
  };
}
function showNotice(message, kind = "") {
  const region = document.querySelector("#notice");
  region.textContent = message;
  region.className = "notice " + kind;
}
function photoInput() {
  return '<div class="optional"><div class="photo-heading">Photo ID <span>Optional</span></div>' +
    '<label class="photo-select" for="photo">' + icon("camera") + '<span>Take or choose photo</span></label>' +
    '<input class="photo-file" type="file" id="photo" accept="image/*">' +
    '<div class="photo-name" id="photo-name" aria-live="polite"></div><div class="photo-retention">ID photos are deleted after 3 days.</div></div>';
}
async function jpeg(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d", {alpha:false});
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.84));
    if (!blob || blob.size > 2_000_000) throw new Error("Use an ID photo under 2 MB.");
    return blob;
  } finally {
    bitmap.close();
  }
}
async function badgePage(badge, message = "") {
  document.title = badge.code + " · Visitor Badge Desk";
  main.innerHTML = '<a class="back-link" href="' + local("/") + '">' + icon("back") + ' Badge roster</a>' +
    intro("BADGE CHECKOUT", badge.code, badge.group) +
    '<div class="checkout-layout"><section class="panel checkout-panel"><div id="notice" class="notice" role="status"></div><div id="checkout-body"><p>Checking availability…</p></div></section><aside class="panel badge-detail"><div class="detail-logo theme-' + badge.theme + '">' + logos(badge) + '</div><div class="detail-qr">' + qr(badge) + '</div><strong>' + badge.code + '</strong><a class="btn outline" href="' + link(badge) + '">Open QR link ' + icon("arrow") + '</a>' +
    (badge.theme === "bank" ? '<div class="bank-call"><b>CALL before sending up</b><a href="tel:8472933838">847-293-3838</a><a href="tel:6023865500">602-386-5500</a></div>' : "") + '</aside></div>';
  if (message) showNotice(message, "success");
  const body = document.querySelector("#checkout-body");
  let active;
  try {
    active = await api("/api/badge/" + badge.slug);
  } catch (error) {
    body.innerHTML = '<p>Badge availability is currently unavailable.</p><a class="btn outline" href="">Reload badge</a>';
    showNotice(error.message, "error");
    return;
  }
  if (active?.occupied) {
    body.innerHTML = '<span class="chip out">Checked out</span><h2>Badge in use</h2><p>When the badge is back, mark it returned so it is available again.</p><button class="btn primary" id="return">' + icon("check") + ' Mark badge returned</button>';
    document.querySelector("#return").onclick = async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await api("/api/badge/" + badge.slug + "/return", {method:"POST"});
        await badgePage(badge, badge.code + " marked returned.");
      } catch (error) {
        showNotice(error.message, "error");
        button.disabled = false;
      }
    };
    return;
  }
  body.innerHTML = '<span class="chip available">Available</span><h2>Who is using this badge?</h2><p>Enter the details of the person receiving ' + badge.code + '.</p>' +
    '<form id="checkout"><div class="fields"><label>First name<input name="first_name" autocomplete="off" maxlength="80" required></label><label>Last name<input name="last_name" autocomplete="off" maxlength="80" required></label></div>' +
    '<label>Phone number<input name="phone" type="tel" autocomplete="off" maxlength="32" required placeholder="Enter phone number"></label>' +
    photoInput() + '<label class="collateral-confirm"><input type="checkbox" name="id_collateral" value="yes" required><span>I took possession of the person’s ID as collateral.</span></label>' + '<button class="btn primary" type="submit">' + icon("check") + ' Check out ' + badge.code + '</button></form>';
  document.querySelector("#photo").addEventListener("change", event => {
    document.querySelector("#photo-name").textContent = event.target.files[0]?.name ?? "";
  });
  document.querySelector("#checkout").onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    showNotice("Saving checkout…");
    try {
      const data = new FormData(form);
      const photo = form.querySelector("#photo").files[0];
      data.delete("photo");
      if (photo) {
        const image = await jpeg(photo).catch(() => {throw new Error("This image could not be read. Try taking another photo or choose a JPEG.");});
        data.append("photo", image, "photo.jpg");
      }
      await api("/api/badge/" + badge.slug, {method:"POST", body:data});
      await badgePage(badge, badge.code + " checked out successfully.");
    } catch (error) {
      showNotice(error.message, "error");
      button.disabled = false;
    }
  };
}
function ownerForm(record) {
  return '<form class="owner-form" data-record="' + esc(record.id) + '"><input name="owner" aria-label="Owner for ' +
    esc(record.badge.toUpperCase()) + '" maxlength="80" placeholder="Unassigned" value="' + esc(record.owner) +
    '"><button class="btn outline" type="submit">Save</button><small role="status"></small></form>';
}
async function history() {
  main.innerHTML = intro("CHECKOUT RECORDS", "Activity log", "Latest 100 checkouts. Excel includes the full log.", '<a class="btn primary" href="' +
    local("/api/history.xlsx") + '" download="badge-activity-log.xlsx">' + icon("arrow") + ' Download Excel</a>') +
    '<div class="panel activity" id="activity"><p>Loading activity…</p></div>';
  const area = document.querySelector("#activity");
  try {
    const records = await api("/api/history");
    if (!records.length) {
      area.innerHTML = '<div class="empty"><span class="stat-icon">' + icon("clock") + '</span><h2>No activity yet</h2><p>Badge checkouts will appear here once recorded.</p><a class="btn outline" href="' + local("/") + '">Open badge roster</a></div>';
      return;
    }
    area.innerHTML = '<table><thead><tr><th>Badge</th><th>Visitor</th><th>Owner</th><th>Checked out</th><th>Returned</th><th>ID photo</th></tr></thead><tbody>' +
      records.map(record => '<tr><td><a href="' + local("/b/") + esc(record.badge) + '">' + esc(record.badge.toUpperCase()) + '</a></td><td>' + esc(record.first_name) + ' ' + esc(record.last_name) + '<small>' + esc(record.phone) + '</small></td><td>' + ownerForm(record) + '</td><td>' + when(record.checked_out_at) + '</td><td>' + (record.returned_at ? when(record.returned_at) : '<span class="chip out">Checked out</span>') + '</td><td>' + (record.has_photo ? '<a href="' + local("/api/record/") + esc(record.id) + '/photo" target="_blank" rel="noopener">View photo</a>' : '—') + '</td></tr>').join("") + '</tbody></table>';
    area.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.target;
      const button = form.querySelector("button");
      const status = form.querySelector('[role="status"]');
      button.disabled = true;
      status.textContent = "Saving…";
      try {
        await api("/api/record/" + form.dataset.record + "/owner", {method:"POST", body:new FormData(form)});
        status.textContent = "Saved";
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  } catch (error) {
    area.innerHTML = '<p>' + esc(error.message) + '</p><a class="btn outline" href="' + local("/history") + '">Try again</a>';
  }
}
try {
  ({badges, origin} = await api("/catalog.json"));
  if (path === "/sheets") printSheets();
  else if (path === "/history") await history();
  else if (path.startsWith("/b/")) {
    const badge = badges.find(item => item.slug === path.slice(3));
    if (badge) await badgePage(badge);
    else main.innerHTML = intro("VISITOR ACCESS", "Badge not found", "Use the badge roster to select a valid card.", '<a class="btn primary" href="' + local("/") + '">Open badge roster</a>');
  } else await roster();
} catch (error) {
  main.textContent = error.message;
}
