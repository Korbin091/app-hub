# 🚀 Tailscale Funnel App Hub

One dashboard. All your apps. **Private by default. Public when you choose.**

A personal app control center that runs on your Tailscale network. Every app you
build is registered in one place with a clean private URL on your tailnet, live
health monitoring, and a one-click toggle to expose it publicly over real HTTPS
via **Tailscale Funnel** — no servers, no DNS, no certificates to manage.

See **[ACTION_PLAN.md](./ACTION_PLAN.md)** for the full build-out plan and milestones.

---

## Features

- **App registry** (`apps.json`) — add / edit / delete apps from the dashboard, with atomic, validated writes.
- **Live health monitoring** — every app pinged every 30s, status badges, response time, uptime %, and a 10-check history.
- **Tailscale Funnel toggle** — make any app public (real HTTPS URL) or retract it in one click; state reconciled with Tailscale on startup.
- **Security guardrail** — apps in the `Security` category (e.g. your password manager) can **never** be made public; enforced in the UI *and* server-side.
- **Device panel** — all tailnet devices with online status and last-seen.
- **MagicDNS hub URL** + **PM2** for an always-on service that survives restarts.

---

## Prerequisites

1. A [Tailscale](https://tailscale.com) account, installed on this host (e.g. your Mac) and your phone.
2. **MagicDNS** enabled (admin panel → Settings → DNS).
3. **Funnel** enabled (admin panel → Settings → Feature Previews). Verify with `tailscale funnel status`.
4. An **API access token** (admin panel → Settings → Keys).
5. **Node.js 18+** and **git**.

---

## Setup

```bash
git clone <this-repo> tailscale-hub
cd tailscale-hub
npm install

cp .env.example .env
# edit .env:
#   TS_API_TOKEN=tskey-api-...
#   TAILNET=yourname.ts.net
#   PORT=3000

npm start
```

Open `http://localhost:3000`, or from any tailnet device:
`http://<this-host>.<tailnet>:3000` (shown as **Your Hub URL** in the header).

---

## Adding an app

Click **+ Add App** and fill in name, port, private URL, icon, and category — or
add an entry to `apps.json` directly:

```json
{
  "id": "password-manager",
  "name": "Password Manager",
  "description": "Bitwarden-synced vault with Tailscale VPN",
  "port": 8080,
  "privateUrl": "http://<host>.<tailnet>:8080",
  "funnelEnabled": false,
  "publicUrl": null,
  "icon": "🔐",
  "category": "Security",
  "addedDate": "2026-06-29"
}
```

> The password manager — and anything in category `Security` — stays private. The
> Funnel toggle is disabled in the UI and the enable endpoint rejects it server-side.

### Standard health endpoint for your apps

So the hub can monitor each app, add this to every app you build:

```js
app.get("/health", (req, res) => {
  res.json({ status: "ok", app: "your-app-name", uptime: process.uptime(), timestamp: new Date().toISOString() });
});
```

---

## Enable / disable Funnel

Use the per-card **Make public** toggle, or the CLI directly:

```bash
tailscale funnel 8081 on     # expose localhost:8081 publicly over HTTPS
tailscale funnel 8081 off    # retract
tailscale funnel status --json
```

The hub reconciles `apps.json` with the live Funnel state on every startup, so
out-of-band CLI changes are picked up automatically.

---

## Run permanently with PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.js   # start the hub
pm2 logs tailscale-hub          # view logs
pm2 stop tailscale-hub          # stop
pm2 startup                     # print the auto-start-on-login command, then run it
pm2 save                        # persist the process list
```

---

## Access from your iPhone

1. Tailscale installed and connected on the phone.
2. Open the **Your Hub URL** from the dashboard header (`http://<host>.<tailnet>:3000`) in Safari.
3. If MagicDNS doesn't resolve, use the host's tailnet IP (from the admin panel) with `:3000`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Tailscale API `401` | Token is read from `.env` as `TS_API_TOKEN` and sent as `Authorization: Bearer …`. Regenerate the key if needed. |
| `tailscale funnel` fails | Enable Funnel (admin panel → Settings → Feature Previews); confirm `tailscale funnel status` runs. |
| MagicDNS URL won't resolve on iPhone | Use the host's tailnet IP + `:3000` as a fallback. |
| Health check hangs | Checks use a 5s `AbortController` timeout and mark the app offline on abort — no hang. |
| `apps.json` corrupted | Writes are atomic (temp file + rename); restore from an exported backup if needed. |
| PM2 not auto-starting after restart | Run `pm2 startup`, run the command it prints, then `pm2 save`. |
| Funnel flags out of sync | The hub reconciles with live Funnel status on startup. |

---

## API reference

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/meta` | Hub URL, tailnet, app count |
| GET | `/api/apps` | List registered apps |
| POST | `/api/apps` | Add an app |
| PUT | `/api/apps/:id` | Update an app |
| DELETE | `/api/apps/:id` | Delete an app (retracts Funnel first) |
| POST | `/api/apps/import` | Replace the registry |
| GET | `/api/devices` | Tailnet devices |
| GET | `/api/health` · `/api/health/:id` | Current status + history |
| POST | `/api/funnel/enable` · `/disable` | Toggle Funnel for an app |
| GET | `/api/funnel/status` | Live Funnel status |
| GET | `/health` | Hub's own health endpoint |

---

*Private by default. Public when you choose. Yours always.*
