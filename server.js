// server.js — Express server for the Tailscale App Hub.
// Serves the dashboard, exposes the registry/health/funnel APIs, and
// reconciles Funnel state on startup.

require("dotenv").config();

const express = require("express");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");

const tailscale = require("./tailscale");
const funnel = require("./funnel");
const health = require("./health");

const PORT = Number(process.env.PORT) || 3000;
const APPS_FILE = path.join(__dirname, "apps.json");
const VALID_CATEGORIES = ["Security", "Tools", "Media", "Productivity", "Dev", "Other"];

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Registry helpers (atomic, validated)
// ---------------------------------------------------------------------------

async function readApps() {
  try {
    const raw = await fsp.readFile(APPS_FILE, "utf8");
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.apps)) return { apps: [] };
    return data;
  } catch (err) {
    if (err.code === "ENOENT") return { apps: [] };
    throw err;
  }
}

async function writeApps(data) {
  // Atomic write: temp file + rename so a crash mid-write can't corrupt apps.json.
  const tmp = `${APPS_FILE}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
  await fsp.rename(tmp, APPS_FILE);
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeCategory(cat) {
  return VALID_CATEGORIES.includes(cat) ? cat : "Other";
}

function validateNewApp(body, existing) {
  const errors = [];
  const name = (body.name || "").trim();
  if (!name) errors.push("name is required");

  const port = Number(body.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push("port must be 1-65535");

  const privateUrl = (body.privateUrl || "").trim();
  if (!privateUrl) errors.push("privateUrl is required");

  const id = slugify(body.id || name);
  if (!id) errors.push("could not derive an id from name");
  if (id && existing.some((a) => a.id === id)) errors.push(`an app with id "${id}" already exists`);
  if (existing.some((a) => Number(a.port) === port)) errors.push(`port ${port} is already registered`);

  const appEntry = {
    id,
    name,
    description: (body.description || "").trim(),
    port,
    privateUrl,
    funnelEnabled: false,
    publicUrl: null,
    icon: (body.icon || "📦").trim() || "📦",
    category: normalizeCategory(body.category),
    addedDate: new Date().toISOString().slice(0, 10),
  };
  return { errors, app: appEntry };
}

// ---------------------------------------------------------------------------
// Hub self health endpoint (the standard every app should expose)
// ---------------------------------------------------------------------------

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: "tailscale-hub",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Meta — hub URL, tailnet, counts
// ---------------------------------------------------------------------------

app.get("/api/meta", async (req, res) => {
  const data = await readApps();
  const hostname = os.hostname();
  const tailnet = (process.env.TAILNET || "").trim();
  const hubUrl =
    tailnet && tailnet !== "-"
      ? `http://${hostname}.${tailnet}:${PORT}`
      : `http://${hostname}:${PORT}`;
  res.json({ hostname, tailnet, hubUrl, port: PORT, totalApps: data.apps.length });
});

// ---------------------------------------------------------------------------
// Apps registry CRUD
// ---------------------------------------------------------------------------

app.get("/api/apps", async (req, res) => {
  res.json(await readApps());
});

app.post("/api/apps", async (req, res) => {
  const data = await readApps();
  const { errors, app: newApp } = validateNewApp(req.body, data.apps);
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });
  data.apps.push(newApp);
  await writeApps(data);
  res.status(201).json(newApp);
});

app.put("/api/apps/:id", async (req, res) => {
  const data = await readApps();
  const idx = data.apps.findIndex((a) => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "app not found" });

  const current = data.apps[idx];
  const body = req.body || {};

  if (body.port !== undefined) {
    const port = Number(body.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      return res.status(400).json({ error: "port must be 1-65535" });
    if (data.apps.some((a) => a.id !== current.id && Number(a.port) === port))
      return res.status(400).json({ error: `port ${port} is already registered` });
    current.port = port;
  }
  if (body.name !== undefined && body.name.trim()) current.name = body.name.trim();
  if (body.description !== undefined) current.description = body.description.trim();
  if (body.privateUrl !== undefined && body.privateUrl.trim()) current.privateUrl = body.privateUrl.trim();
  if (body.icon !== undefined && body.icon.trim()) current.icon = body.icon.trim();
  if (body.category !== undefined) current.category = normalizeCategory(body.category);

  data.apps[idx] = current;
  await writeApps(data);
  res.json(current);
});

app.delete("/api/apps/:id", async (req, res) => {
  const data = await readApps();
  const idx = data.apps.findIndex((a) => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "app not found" });

  const target = data.apps[idx];
  // If the app is funneled, retract it first so we don't leave it public.
  if (target.funnelEnabled) {
    try {
      await funnel.disableFunnel(target.port);
    } catch (err) {
      return res.status(500).json({ error: `could not disable Funnel before delete: ${err.message}` });
    }
  }
  data.apps.splice(idx, 1);
  await writeApps(data);
  res.json({ ok: true });
});

// Replace the whole registry (Import). Validates every entry.
app.post("/api/apps/import", async (req, res) => {
  const incoming = req.body && Array.isArray(req.body.apps) ? req.body.apps : null;
  if (!incoming) return res.status(400).json({ error: "expected { apps: [...] }" });

  const seenIds = new Set();
  const seenPorts = new Set();
  for (const a of incoming) {
    if (!a.id || !a.name || !a.privateUrl || !Number.isInteger(Number(a.port)))
      return res.status(400).json({ error: "each app needs id, name, port, privateUrl" });
    if (seenIds.has(a.id)) return res.status(400).json({ error: `duplicate id: ${a.id}` });
    if (seenPorts.has(Number(a.port))) return res.status(400).json({ error: `duplicate port: ${a.port}` });
    seenIds.add(a.id);
    seenPorts.add(Number(a.port));
  }
  await writeApps({ apps: incoming });
  res.json({ ok: true, count: incoming.length });
});

// ---------------------------------------------------------------------------
// Devices (Tailscale API)
// ---------------------------------------------------------------------------

app.get("/api/devices", async (req, res) => {
  try {
    res.json({ devices: await tailscale.getDevices() });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

app.get("/api/health", (req, res) => {
  res.json(health.getAll());
});

app.get("/api/health/:id", (req, res) => {
  res.json(health.getOne(req.params.id));
});

// ---------------------------------------------------------------------------
// Funnel (public URLs)
// ---------------------------------------------------------------------------

app.post("/api/funnel/enable", async (req, res) => {
  const { appId, port } = req.body || {};
  const data = await readApps();
  const target = data.apps.find((a) => a.id === appId);
  if (!target) return res.status(404).json({ error: "app not found" });

  // Hard guard: Security-category apps can never be made public.
  if (target.category === "Security") {
    return res.status(403).json({ error: "Security apps cannot be made public." });
  }

  const usePort = port || target.port;
  try {
    await funnel.enableFunnel(usePort);
    let publicUrl = null;
    try {
      const status = await funnel.getFunnelStatus();
      publicUrl = funnel.getPublicUrl(usePort, status);
    } catch (_) {
      // Funnel turned on but status read failed — leave publicUrl null.
    }
    target.funnelEnabled = true;
    target.publicUrl = publicUrl;
    await writeApps(data);
    res.json({ ok: true, app: target });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/funnel/disable", async (req, res) => {
  const { appId, port } = req.body || {};
  const data = await readApps();
  const target = data.apps.find((a) => a.id === appId);
  if (!target) return res.status(404).json({ error: "app not found" });

  const usePort = port || target.port;
  try {
    await funnel.disableFunnel(usePort);
    target.funnelEnabled = false;
    target.publicUrl = null;
    await writeApps(data);
    res.json({ ok: true, app: target });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/funnel/status", async (req, res) => {
  try {
    res.json(await funnel.getFunnelStatus());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Startup: reconcile funnel state, start monitor, log health
// ---------------------------------------------------------------------------

async function reconcileFunnel() {
  let status;
  try {
    status = await funnel.getFunnelStatus();
  } catch (err) {
    console.warn(`[Hub] Funnel status unavailable at startup: ${err.message}`);
    return;
  }
  const data = await readApps();
  const activePorts = new Set(status.served.map((s) => s.proxyPort));
  let changed = false;
  for (const a of data.apps) {
    const isActive = activePorts.has(Number(a.port));
    if (isActive && !a.funnelEnabled) {
      a.funnelEnabled = true;
      a.publicUrl = funnel.getPublicUrl(a.port, status);
      changed = true;
    } else if (!isActive && a.funnelEnabled) {
      a.funnelEnabled = false;
      a.publicUrl = null;
      changed = true;
    }
  }
  if (changed) {
    await writeApps(data);
    console.log("[Hub] Reconciled apps.json with live Funnel state.");
  }
}

function start() {
  app.listen(PORT, () => {
    const hostname = os.hostname();
    const tailnet = (process.env.TAILNET || "").trim();
    console.log(`[Hub] Dashboard running on http://localhost:${PORT}`);
    if (tailnet && tailnet !== "-") {
      console.log(`[Hub] MagicDNS URL: http://${hostname}.${tailnet}:${PORT}`);
    }

    reconcileFunnel().catch((err) => console.warn(`[Hub] reconcile failed: ${err.message}`));

    // Background health monitoring (immediate pass + every 30s).
    health.startMonitor(async () => (await readApps()).apps, 30000);

    // Startup health summary after things settle.
    setTimeout(async () => {
      try {
        const apps = (await readApps()).apps;
        const statuses = health.getAll();
        const online = apps.filter((a) => statuses[a.id] && statuses[a.id].status === "online").length;
        console.log(`[Hub] ${online}/${apps.length} apps online at startup`);
      } catch (_) {
        /* ignore */
      }
    }, 5000);
  });
}

if (require.main === module) {
  start();
}

module.exports = { app, readApps, writeApps, validateNewApp, slugify };
