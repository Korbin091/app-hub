// tailscale.js — minimal Tailscale API client for tailnet device info.
//
// Auth: Bearer token from .env (TS_API_TOKEN). Tailnet from .env (TAILNET);
// "-" means the default tailnet of the authenticated token.

const TS_API_BASE = "https://api.tailscale.com/api/v2";

function requireToken() {
  const token = process.env.TS_API_TOKEN;
  if (!token) {
    throw new Error("TS_API_TOKEN is not set in .env");
  }
  return token;
}

function tailnet() {
  return process.env.TAILNET && process.env.TAILNET.trim() ? process.env.TAILNET.trim() : "-";
}

async function apiGet(pathname) {
  const token = requireToken();
  const res = await fetch(`${TS_API_BASE}${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    throw new Error("Tailscale API authentication failed (401). Check TS_API_TOKEN in .env.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tailscale API error ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Returns a normalized list of tailnet devices for the sidebar.
 */
async function getDevices() {
  const data = await apiGet(`/tailnet/${encodeURIComponent(tailnet())}/devices`);
  const devices = Array.isArray(data.devices) ? data.devices : [];
  return devices
    .map((d) => ({
      name: d.hostname || d.name || "(unknown)",
      fqdn: d.name || null,
      addresses: d.addresses || [],
      os: d.os || null,
      online: !!d.online,
      lastSeen: d.lastSeen || null,
    }))
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}

module.exports = { getDevices, tailnet };
