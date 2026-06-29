// health.js — pings every registered app and keeps a short status history.
//
// - checkApp(app):     HTTP GET privateUrl, 5s timeout, retry once after 2s
// - checkAllApps(apps): parallel checks for an array of apps
// - getAll() / getOne(id): current status + history for the dashboard
// - startMonitor(getAppsFn, intervalMs): background loop on a timer
//
// On an online -> offline transition we fire a one-time macOS notification.

const os = require("os");
const { execFile } = require("child_process");

const MAX_HISTORY = 10;
const REQUEST_TIMEOUT_MS = 5000;
const RETRY_DELAY_MS = 2000;

/** id -> array of { status, responseTime, checkedAt } (most recent last) */
const history = new Map();
/** id -> "online" | "offline" — last known status, for transition detection */
const lastStatus = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pingOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "manual" });
    const responseTime = Date.now() - start;
    // 200-399 counts as online (manual redirect keeps 3xx as-is)
    const ok = res.status >= 200 && res.status < 400;
    return { ok, responseTime };
  } catch (err) {
    // AbortError (timeout), connection refused, DNS failure -> offline
    return { ok: false, responseTime: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

function record(id, entry) {
  const arr = history.get(id) || [];
  arr.push(entry);
  while (arr.length > MAX_HISTORY) arr.shift();
  history.set(id, arr);
}

function escapeForOsascript(str) {
  return String(str).replace(/[\\"]/g, "\\$&");
}

function maybeNotify(app, status) {
  const prev = lastStatus.get(app.id);
  lastStatus.set(app.id, status);
  // Only notify on the online -> offline transition, not every failed check.
  if (prev === "online" && status === "offline") {
    if (os.platform() !== "darwin") return;
    const msg = escapeForOsascript(`${app.name} is down`);
    execFile(
      "osascript",
      ["-e", `display notification "${msg}" with title "App Hub Alert"`],
      () => {} // best-effort; ignore errors
    );
  }
}

async function checkApp(app) {
  if (!app || !app.privateUrl) {
    const entry = { status: "offline", responseTime: 0, checkedAt: new Date().toISOString() };
    if (app) record(app.id, entry);
    return entry;
  }

  let result = await pingOnce(app.privateUrl);
  if (!result.ok) {
    await sleep(RETRY_DELAY_MS);
    result = await pingOnce(app.privateUrl);
  }

  const entry = {
    status: result.ok ? "online" : "offline",
    responseTime: result.responseTime,
    checkedAt: new Date().toISOString(),
  };
  record(app.id, entry);
  maybeNotify(app, entry.status);
  return entry;
}

async function checkAllApps(apps) {
  return Promise.all((apps || []).map((a) => checkApp(a)));
}

function calculateUptime(id) {
  const arr = history.get(id) || [];
  if (arr.length === 0) return null;
  const online = arr.filter((e) => e.status === "online").length;
  return Math.round((online / arr.length) * 100);
}

function averageResponseTime(id) {
  const arr = history.get(id) || [];
  if (arr.length === 0) return null;
  const sum = arr.reduce((acc, e) => acc + (e.responseTime || 0), 0);
  return Math.round(sum / arr.length);
}

function summarize(id) {
  const arr = history.get(id) || [];
  const latest = arr[arr.length - 1] || null;
  return {
    status: latest ? latest.status : "unknown",
    responseTime: latest ? latest.responseTime : null,
    checkedAt: latest ? latest.checkedAt : null,
    uptime: calculateUptime(id),
    avgResponseTime: averageResponseTime(id),
    history: arr,
  };
}

function getAll() {
  const out = {};
  for (const id of history.keys()) out[id] = summarize(id);
  return out;
}

function getOne(id) {
  return summarize(id);
}

async function runChecks(getAppsFn) {
  const apps = await getAppsFn();
  await checkAllApps(apps);
}

function startMonitor(getAppsFn, intervalMs = 30000) {
  // Immediate first pass so the dashboard isn't blank, then on a timer.
  runChecks(getAppsFn).catch((err) => console.warn("[Hub] health check failed:", err.message));
  setInterval(() => {
    runChecks(getAppsFn).catch((err) => console.warn("[Hub] health check failed:", err.message));
  }, intervalMs);
}

module.exports = {
  checkApp,
  checkAllApps,
  calculateUptime,
  getAll,
  getOne,
  startMonitor,
};
