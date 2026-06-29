// app.js — dashboard frontend (vanilla JS).

const state = {
  apps: [],
  health: {},
  filter: "All",
  expanded: new Set(),
  prevStatus: {}, // id -> last rendered status, for pulse animation
};

const CATEGORIES = ["All", "Security", "Tools", "Media", "Productivity", "Dev", "Other"];

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${method} ${path} failed (${res.status})`);
  return data;
}

function toast(message, type = "") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  document.getElementById("toast-container").appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function copy(text) {
  navigator.clipboard.writeText(text).then(
    () => toast("Copied to clipboard", "success"),
    () => toast("Could not copy", "error")
  );
}

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : String(str);
  return d.innerHTML;
}

// --------------------------------------------------------------------------
// Data loading
// --------------------------------------------------------------------------

async function loadMeta() {
  try {
    const meta = await api("GET", "/api/meta");
    document.getElementById("tailnet-label").textContent = meta.tailnet
      ? `tailnet: ${meta.tailnet}`
      : "";
    if (meta.hubUrl) {
      document.getElementById("hub-url").textContent = meta.hubUrl;
      document.getElementById("hub-url-wrap").hidden = false;
    }
  } catch (_) {
    /* non-fatal */
  }
}

async function loadApps() {
  const data = await api("GET", "/api/apps");
  state.apps = data.apps || [];
  renderGrid();
  renderFunnelPanel();
}

async function loadHealth() {
  try {
    state.health = await api("GET", "/api/health");
    updateHealthInPlace();
    updateHealthSummary();
  } catch (_) {
    /* non-fatal */
  }
}

async function loadDevices() {
  const list = document.getElementById("device-list");
  try {
    const { devices } = await api("GET", "/api/devices");
    if (!devices.length) {
      list.innerHTML = '<li class="muted">No devices</li>';
      return;
    }
    list.innerHTML = devices
      .map((d) => {
        const seen = d.online
          ? "online"
          : d.lastSeen
          ? `last seen ${new Date(d.lastSeen).toLocaleDateString()}`
          : "offline";
        return `<li><div class="device-row">
            <span class="dot ${d.online ? "online" : "offline"}"></span>
            <span class="device-name">${esc(d.name)}</span>
          </div><span class="device-meta">${esc(seen)}</span></li>`;
      })
      .join("");
  } catch (err) {
    list.innerHTML = `<li class="muted">${esc(err.message)}</li>`;
  }
}

// --------------------------------------------------------------------------
// Rendering
// --------------------------------------------------------------------------

function renderFilters() {
  const nav = document.getElementById("category-filters");
  nav.innerHTML = CATEGORIES.map(
    (c) => `<button class="filter-btn ${c === state.filter ? "active" : ""}" data-cat="${c}">${c}</button>`
  ).join("");
  nav.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.onclick = () => {
      state.filter = btn.dataset.cat;
      renderFilters();
      renderGrid();
    };
  });
}

function cardHealth(id) {
  return state.health[id] || { status: "unknown", responseTime: null, uptime: null, history: [] };
}

function renderGrid() {
  const grid = document.getElementById("app-grid");
  const apps = state.apps.filter((a) => state.filter === "All" || a.category === state.filter);

  if (!apps.length) {
    grid.innerHTML = `<p class="muted">No apps yet. Click “+ Add App” to register your first one.</p>`;
    return;
  }

  grid.innerHTML = apps.map(renderCard).join("");
  apps.forEach(wireCard);
}

function renderCard(a) {
  const h = cardHealth(a.id);
  const isSecurity = a.category === "Security";
  const expanded = state.expanded.has(a.id);

  const badge = `<span class="badge ${h.status}" id="badge-${a.id}">
      ${h.status === "online" ? "● Online" : h.status === "offline" ? "● Offline" : "○ Unknown"}
    </span>`;

  const rt = h.responseTime != null ? `<span class="muted" id="rt-${a.id}">${h.responseTime} ms</span>` : `<span class="muted" id="rt-${a.id}"></span>`;
  const uptime = h.uptime != null ? `<span class="muted" id="up-${a.id}">${h.uptime}% up</span>` : `<span class="muted" id="up-${a.id}"></span>`;

  const publicChip = a.funnelEnabled && a.publicUrl
    ? `<div class="card-row"><span class="public-chip">🌐
         <a class="link" href="${esc(a.publicUrl)}" target="_blank" rel="noopener">${esc(a.publicUrl)}</a>
         <button class="icon-btn" data-copy="${esc(a.publicUrl)}" title="Copy">⧉</button></span></div>`
    : "";

  const toggle = `
    <div class="toggle-wrap">
      <label class="toggle">
        <input type="checkbox" data-funnel="${a.id}" ${a.funnelEnabled ? "checked" : ""} ${isSecurity ? "disabled" : ""} />
        <span class="slider"></span>
      </label>
      <span class="toggle-label">${isSecurity ? "🔒 Private only" : a.funnelEnabled ? "Public" : "Make public"}</span>
    </div>`;

  const dots = (h.history || [])
    .map((e) => `<span class="hdot ${e.status}" title="${esc(e.checkedAt)} · ${e.responseTime}ms"></span>`)
    .join("");

  return `<div class="card" data-id="${a.id}">
    <div class="card-head">
      <span class="card-icon">${esc(a.icon || "📦")}</span>
      <div>
        <div class="card-title">${esc(a.name)} ${isSecurity ? "🔒" : ""}</div>
        <div class="card-cat">${esc(a.category)}</div>
      </div>
      <div class="card-actions">
        <button class="icon-btn" data-edit="${a.id}" title="Edit">⚙️</button>
        <button class="icon-btn" data-delete="${a.id}" title="Delete">🗑️</button>
      </div>
    </div>
    ${a.description ? `<p class="card-desc">${esc(a.description)}</p>` : ""}
    <div class="card-row">
      <a class="link" href="${esc(a.privateUrl)}" target="_blank" rel="noopener">${esc(a.privateUrl)}</a>
    </div>
    ${publicChip}
    <div class="card-row">
      ${badge} ${rt} ${uptime}
      <button class="icon-btn" data-history="${a.id}" title="History" style="margin-left:auto">📈</button>
    </div>
    <div class="history ${expanded ? "show" : ""}" id="hist-${a.id}">${dots}</div>
    ${toggle}
  </div>`;
}

function wireCard(a) {
  const grid = document.getElementById("app-grid");
  const card = grid.querySelector(`.card[data-id="${a.id}"]`);
  if (!card) return;

  card.querySelector(`[data-edit="${a.id}"]`).onclick = () => openModal(a);
  card.querySelector(`[data-delete="${a.id}"]`).onclick = () => deleteApp(a);
  card.querySelector(`[data-history="${a.id}"]`).onclick = () => {
    if (state.expanded.has(a.id)) state.expanded.delete(a.id);
    else state.expanded.add(a.id);
    card.querySelector(`#hist-${a.id}`).classList.toggle("show");
  };
  const funnelToggle = card.querySelector(`[data-funnel="${a.id}"]`);
  if (funnelToggle) funnelToggle.onchange = () => toggleFunnel(a, funnelToggle);
  card.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => copy(b.dataset.copy)));
}

function updateHealthInPlace() {
  for (const a of state.apps) {
    const h = cardHealth(a.id);
    const badge = document.getElementById(`badge-${a.id}`);
    if (!badge) continue;
    const prev = state.prevStatus[a.id];
    badge.className = `badge ${h.status}`;
    badge.textContent = h.status === "online" ? "● Online" : h.status === "offline" ? "● Offline" : "○ Unknown";
    if (prev && prev !== h.status) {
      badge.classList.add("pulse");
      setTimeout(() => badge.classList.remove("pulse"), 600);
    }
    state.prevStatus[a.id] = h.status;
    const rt = document.getElementById(`rt-${a.id}`);
    if (rt) rt.textContent = h.responseTime != null ? `${h.responseTime} ms` : "";
    const up = document.getElementById(`up-${a.id}`);
    if (up) up.textContent = h.uptime != null ? `${h.uptime}% up` : "";
    const hist = document.getElementById(`hist-${a.id}`);
    if (hist) {
      hist.innerHTML = (h.history || [])
        .map((e) => `<span class="hdot ${e.status}" title="${esc(e.checkedAt)} · ${e.responseTime}ms"></span>`)
        .join("");
    }
  }
}

function updateHealthSummary() {
  const total = state.apps.length;
  const online = state.apps.filter((a) => cardHealth(a.id).status === "online").length;
  document.getElementById("health-summary").textContent = total ? `${online}/${total} apps online` : "No apps";
}

function renderFunnelPanel() {
  const funneled = state.apps.filter((a) => a.funnelEnabled);
  document.getElementById("funnel-count").textContent = funneled.length;
  const list = document.getElementById("funnel-list");
  list.innerHTML = funneled.length
    ? funneled
        .map(
          (a) => `<li><span>${esc(a.icon)} ${esc(a.name)}</span>
            ${a.publicUrl ? `<a class="link" href="${esc(a.publicUrl)}" target="_blank" rel="noopener">${esc(a.publicUrl)}</a>` : '<span class="muted">URL pending</span>'}
            <button class="btn btn-ghost btn-sm" data-retract="${a.id}" style="margin-left:auto">Retract</button></li>`
        )
        .join("")
    : '<li class="muted">No public apps.</li>';
  list.querySelectorAll("[data-retract]").forEach((b) => {
    b.onclick = () => {
      const a = state.apps.find((x) => x.id === b.dataset.retract);
      if (a) setFunnel(a, false);
    };
  });
}

// --------------------------------------------------------------------------
// Actions
// --------------------------------------------------------------------------

async function toggleFunnel(a, inputEl) {
  const makePublic = inputEl.checked;
  if (!makePublic) {
    if (!confirm(`This will remove public access to "${a.name}". Continue?`)) {
      inputEl.checked = true;
      return;
    }
  }
  inputEl.disabled = true;
  try {
    await setFunnel(a, makePublic);
  } finally {
    inputEl.disabled = a.category === "Security";
  }
}

async function setFunnel(a, makePublic) {
  try {
    const path = makePublic ? "/api/funnel/enable" : "/api/funnel/disable";
    await api("POST", path, { appId: a.id, port: a.port });
    toast(makePublic ? `${a.name} is now public` : `${a.name} retracted`, "success");
    await loadApps();
  } catch (err) {
    toast(err.message, "error");
    await loadApps();
  }
}

async function deleteApp(a) {
  if (!confirm(`Delete "${a.name}" from the registry?`)) return;
  try {
    await api("DELETE", `/api/apps/${a.id}`);
    toast(`${a.name} deleted`, "success");
    await loadApps();
  } catch (err) {
    toast(err.message, "error");
  }
}

// --------------------------------------------------------------------------
// Modal (add / edit)
// --------------------------------------------------------------------------

function openModal(app) {
  const editing = !!app;
  document.getElementById("modal-title").textContent = editing ? "Edit App" : "Add App";
  document.getElementById("f-id").value = editing ? app.id : "";
  document.getElementById("f-name").value = editing ? app.name : "";
  document.getElementById("f-description").value = editing ? app.description || "" : "";
  document.getElementById("f-port").value = editing ? app.port : "";
  document.getElementById("f-icon").value = editing ? app.icon || "" : "";
  document.getElementById("f-privateUrl").value = editing ? app.privateUrl : "";
  document.getElementById("f-category").value = editing ? app.category : "Tools";
  document.getElementById("form-error").hidden = true;
  document.getElementById("app-modal").hidden = false;
}

function closeModal() {
  document.getElementById("app-modal").hidden = true;
}

async function submitForm(e) {
  e.preventDefault();
  const id = document.getElementById("f-id").value;
  const payload = {
    name: document.getElementById("f-name").value,
    description: document.getElementById("f-description").value,
    port: Number(document.getElementById("f-port").value),
    icon: document.getElementById("f-icon").value,
    privateUrl: document.getElementById("f-privateUrl").value,
    category: document.getElementById("f-category").value,
  };
  try {
    if (id) await api("PUT", `/api/apps/${id}`, payload);
    else await api("POST", "/api/apps", payload);
    closeModal();
    toast(id ? "App updated" : "App added", "success");
    await loadApps();
  } catch (err) {
    const errEl = document.getElementById("form-error");
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
}

// --------------------------------------------------------------------------
// Export / Import
// --------------------------------------------------------------------------

async function exportRegistry() {
  const data = await api("GET", "/api/apps");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "apps.json";
  a.click();
  URL.revokeObjectURL(url);
}

async function importRegistry(file) {
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    await api("POST", "/api/apps/import", json);
    toast("Registry imported", "success");
    await loadApps();
  } catch (err) {
    toast(`Import failed: ${err.message}`, "error");
  }
}

// --------------------------------------------------------------------------
// Wiring
// --------------------------------------------------------------------------

function init() {
  renderFilters();

  document.getElementById("add-app-btn").onclick = () => openModal(null);
  document.getElementById("modal-cancel").onclick = closeModal;
  document.getElementById("app-form").onsubmit = submitForm;
  document.getElementById("app-modal").onclick = (e) => {
    if (e.target.id === "app-modal") closeModal();
  };

  document.getElementById("copy-hub-url").onclick = () =>
    copy(document.getElementById("hub-url").textContent);

  document.getElementById("funnel-panel-toggle").onclick = () => {
    const body = document.getElementById("funnel-panel-body");
    body.hidden = !body.hidden;
  };
  document.getElementById("retract-all").onclick = async () => {
    const funneled = state.apps.filter((a) => a.funnelEnabled);
    if (!funneled.length) return;
    if (!confirm(`Retract all ${funneled.length} public app(s)?`)) return;
    for (const a of funneled) await setFunnel(a, false);
  };
  document.getElementById("export-btn").onclick = exportRegistry;
  document.getElementById("import-input").onchange = (e) => {
    if (e.target.files[0]) importRegistry(e.target.files[0]);
    e.target.value = "";
  };

  loadMeta();
  loadApps().then(loadHealth);
  loadDevices();

  // Poll health and devices every 30s.
  setInterval(loadHealth, 30000);
  setInterval(loadDevices, 30000);
}

document.addEventListener("DOMContentLoaded", init);
