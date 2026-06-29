// funnel.js — wraps the `tailscale funnel` CLI to expose/retract apps publicly.
//
// Only validated integer ports are ever passed to the CLI (no raw user
// strings interpolated into a shell). All functions return promises.

const { execFile } = require("child_process");

const CLI_TIMEOUT_MS = 15000;

function runTailscale(args) {
  return new Promise((resolve, reject) => {
    execFile("tailscale", args, { timeout: CLI_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) {
        const detail = (stderr || err.message || "").trim();
        return reject(new Error(detail || `tailscale ${args.join(" ")} failed`));
      }
      resolve(stdout);
    });
  });
}

function assertPort(port) {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) {
    throw new Error(`Invalid port: ${port}`);
  }
  return String(p);
}

async function enableFunnel(port) {
  const p = assertPort(port);
  await runTailscale(["funnel", p, "on"]);
  return true;
}

async function disableFunnel(port) {
  const p = assertPort(port);
  await runTailscale(["funnel", p, "off"]);
  return true;
}

/**
 * Parses `tailscale funnel status --json` into a list of served ports.
 * The serve config maps a public host:port to handlers that proxy to a
 * local port; entries flagged in AllowFunnel are publicly reachable.
 */
function parseFunnelStatus(stdout) {
  let cfg;
  try {
    cfg = JSON.parse(stdout);
  } catch (err) {
    return { raw: stdout, served: [] };
  }

  const served = [];
  const web = cfg.Web || {};
  const allow = cfg.AllowFunnel || {};

  for (const [hostport, conf] of Object.entries(web)) {
    if (!allow[hostport]) continue; // only publicly funneled hosts
    const handlers = (conf && conf.Handlers) || {};
    for (const handler of Object.values(handlers)) {
      const proxy = handler && handler.Proxy;
      if (!proxy) continue;
      const match = String(proxy).match(/:(\d+)(?:\/|$)/);
      if (!match) continue;
      served.push({
        proxyPort: Number(match[1]),
        host: hostport.split(":")[0],
        hostport,
      });
    }
  }
  return { raw: cfg, served };
}

async function getFunnelStatus() {
  try {
    const stdout = await runTailscale(["funnel", "status", "--json"]);
    return parseFunnelStatus(stdout);
  } catch (err) {
    // Surface a clear, actionable message for the dashboard / logs.
    throw new Error(
      `Could not read Funnel status: ${err.message}. ` +
        `Ensure Funnel is enabled (admin panel > Settings > Feature Previews).`
    );
  }
}

/**
 * Derives the public HTTPS URL for a locally-served port from a parsed
 * funnel status. Funnel terminates HTTPS on 443, so the URL is https://<host>.
 */
function getPublicUrl(port, status) {
  const p = Number(port);
  const match = (status && status.served ? status.served : []).find((s) => s.proxyPort === p);
  if (!match) return null;
  return `https://${match.host}`;
}

module.exports = {
  enableFunnel,
  disableFunnel,
  getFunnelStatus,
  getPublicUrl,
  parseFunnelStatus,
};
