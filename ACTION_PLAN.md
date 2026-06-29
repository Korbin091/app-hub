# 🚀 Tailscale Funnel App Hub — Build-Out Action Plan

> Derived from **"Tailscale Funnel App Hub — Complete Claude Code Prompt Framework (Option B)."**
> This document turns that prompt framework into a concrete, sequenced engineering plan:
> what to build, in what order, where the code lives, and how we know each piece is done.

---

## 1. Goal & Outcome

Build a **personal app control center** that:

- Runs on a Mac (or any tailnet device) and is reachable privately at `http://<mac-hostname>.<tailnet>.ts.net:3000` via MagicDNS.
- Registers every personal app in a single `apps.json` registry.
- Shows each app as a card with **live health status**, private URL, and a **Funnel toggle**.
- Exposes any chosen app publicly over real HTTPS via **Tailscale Funnel** — one click, no DNS, no certs, no extra servers.
- Keeps **Security-category apps (e.g. the Bitwarden password manager) permanently private** — Funnel is hard-disabled for them.
- Stays running across restarts via **PM2**.

**Definition of done (whole project):** From a fresh clone, a documented setup gets the hub running under PM2, the password manager registered and private, at least one app toggled public via Funnel and reachable over HTTPS, and health badges updating live on iPhone Safari over the tailnet.

---

## 2. Architecture Summary

```
Devices (iPhone / Mac / iPad)
        │  Tailscale mesh (private, encrypted)
        ▼
App Hub Dashboard  ──  http://<mac>.<tailnet>.ts.net:3000   (private)
   ├─ Express server (server.js)          REST API + static host
   ├─ apps.json                           app registry (source of truth)
   ├─ tailscale.js                        Tailscale API client (devices)
   ├─ funnel.js                           Funnel CLI wrapper (public URLs)
   ├─ health.js                           health checker + history
   └─ public/ (index.html, style.css, app.js)   vanilla-JS dashboard
        │  Tailscale Funnel (optional, per-app)
        ▼
https://<mac>.<tailnet>.ts.net           real HTTPS, reachable anywhere
```

**Stack:** Node.js 18+ · Express · vanilla HTML/CSS/JS (no framework) · `dotenv` · PM2.
**Cost:** $0 (free personal Tailscale plan). **No external server required.**

---

## 3. Prerequisites (one-time, ~15 min, before any coding)

These are operator/account tasks, not code. Track as a checklist:

- [ ] Tailscale account created; Tailscale installed on Mac (dashboard host) + iPhone.
- [ ] Note **Tailnet name** (`<name>.ts.net`) from `login.tailscale.com/admin`.
- [ ] Generate **API access token** (`tskey-api-…`) → Settings > Keys.
- [ ] Enable **MagicDNS** → Settings > DNS.
- [ ] Enable **Funnel** → Settings > Feature Previews.
- [ ] Verify `tailscale funnel status` returns without error on the Mac.
- [ ] Confirm toolchain: `node -v` ≥ 18, `git --version`, `hostname`.

> ⚠️ The API token and tailnet name are **secrets/config** — they live only in `.env`, which is git-ignored. Nothing in this repo should ever contain a real token.

---

## 4. Repository Layout (target)

```
tailscale-hub/                 (this repo)
├── server.js                  Express server + API routes
├── tailscale.js               Tailscale API module (devices, tailnet info)
├── funnel.js                  Funnel management module (CLI wrapper)
├── health.js                  App health checker + in-memory history
├── apps.json                  app registry (committed with example/empty apps)
├── ecosystem.config.js        PM2 process definition
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── .env.example               documents required vars (TS_API_TOKEN, TAILNET, PORT)
├── .env                       real secrets — GIT-IGNORED, never committed
├── .gitignore                 must include .env and node_modules
├── package.json
├── README.md
└── ACTION_PLAN.md             (this file)
```

---

## 5. Milestones & Task Breakdown

Each milestone maps to a phase of the source framework. Build **in order** — each depends on the previous. Recommended: one feature branch/PR per milestone, or commit-per-milestone on the working branch.

### Milestone 0 — Scaffold & Foundations
*Goal: project skeleton, secrets handling, runnable empty server.*

- [ ] `npm init`; add deps: `express`, `dotenv`. Dev/runtime: PM2 (global).
- [ ] Create `.gitignore` (`.env`, `node_modules/`, `*.log`, `apps.json.tmp`).
- [ ] Create `.env.example` with `TS_API_TOKEN=`, `TAILNET=`, `PORT=3000`.
- [ ] Create all empty module files + `public/` shell per the layout above.
- [ ] `server.js`: Express on `PORT` (default 3000), serve `public/` statically, load `.env` via `dotenv`.
- [ ] Seed `apps.json` as `{ "apps": [] }`.

**Acceptance:** `node server.js` starts, `http://localhost:3000` serves a placeholder page, `.env` is ignored by git.

---

### Milestone 1 — Server API & Dashboard UI *(Framework Phase 1)*
*Goal: the core dashboard and its read APIs.*

**Server (`server.js`) endpoints:**
- [ ] `GET /api/apps` → return `apps.json`.
- [ ] `GET /api/devices` → tailnet devices via Tailscale API (`tailscale.js`).
- [ ] `GET /api/health` → current health of all apps (stub until M3).
- [ ] `POST /api/apps` → add an app (full validation in M2).
- [ ] `POST /api/funnel/enable` / `POST /api/funnel/disable` / `GET /api/funnel/status` (stubs wired in M4).

**Dashboard (`public/`):**
- [ ] Dark sidebar (Tailscale purple `#6C47FF`) listing tailnet devices + online state + last-seen.
- [ ] Main area: responsive card grid, one card per app (name, description, private URL, status badge, Funnel toggle, last-checked).
- [ ] Header: "My App Hub" + tailnet name + total app count.
- [ ] "Add App" button → modal form (name, description, port, private URL).
- [ ] Auto-refresh status every 30s without full reload (fetch + DOM patch).
- [ ] Design: `#6C47FF` purple / `#00BFA5` teal / white cards / `system-ui`; smooth toggle animation; toast notifications.
- [ ] Verified usable on iPhone Safari over the tailnet (responsive).

**Acceptance:** Dashboard renders cards from `apps.json`, device sidebar populates from the Tailscale API, layout works on mobile.

---

### Milestone 2 — App Registry System *(Framework Phase 2)*
*Goal: full CRUD over the registry with safe writes.*

- [ ] **Atomic writes:** write `apps.json.tmp` then rename → prevents corruption on crash.
- [ ] **Validation:** require `id`, `name`, `port`, `privateUrl`; auto-generate `id` from name (lowercase, hyphens); reject duplicate IDs; reject ports already registered.
- [ ] **Add modal:** fields incl. emoji icon picker + category (`Security | Tools | Media | Productivity | Dev | Other`); `POST /api/apps`; grid refreshes without reload.
- [ ] **Edit:** gear icon → pre-filled modal → `PUT /api/apps/:id`.
- [ ] **Delete:** trash icon → confirm dialog → `DELETE /api/apps/:id`; if Funnel enabled, disable Funnel first.
- [ ] **Categories view:** header filter buttons + "All".
- [ ] **Export / Import:** download `apps.json` backup; upload to restore.

**Acceptance:** Apps can be added/edited/deleted from the UI; `apps.json` never corrupts on concurrent/abrupt writes; duplicate id/port rejected with clear messages.

---

### Milestone 3 — Health Monitor *(Framework Phase 3)*
*Goal: live per-app status with history.*

**`health.js`:**
- [ ] `checkApp(app)` → HTTP GET `privateUrl` with **5s AbortController timeout**; `200–399 = online`, else offline; returns `{ status, responseTime, checkedAt }`.
- [ ] **Auto-retry once** after 2s before marking offline.
- [ ] `checkAllApps()` → `Promise.all` over all apps.
- [ ] In-memory store: `Map` by app id, **last 10 results** each.
- [ ] `calculateUptime(appId)` → % online of last 10.

**Scheduling & API:**
- [ ] `setInterval` runs `checkAllApps` every 30s from server start.
- [ ] `GET /api/health` (all) and `GET /api/health/:id` (status + history).
- [ ] **Mac notification on online→offline transition only** via `osascript` (not every failed check).

**Dashboard:**
- [ ] Poll `/api/health` every 30s; patch badge + response time without reload; pulse animation on change.
- [ ] Header summary: "5/5 apps online".
- [ ] Click card → expand history panel: last 10 checks as green/red dots + avg response time + uptime %.

**Acceptance:** Badges flip live as apps go up/down; offline apps don't hang the checker; transition notification fires once.

---

### Milestone 4 — Tailscale Funnel Integration *(Framework Phase 4)*
*Goal: per-app public HTTPS toggle — the Option B superpower.*

**`funnel.js`:**
- [ ] `enableFunnel(port)` → `tailscale funnel <port> on` via `child_process.exec`.
- [ ] `disableFunnel(port)` → `tailscale funnel <port> off`.
- [ ] `getFunnelStatus()` → parse `tailscale funnel status --json`.
- [ ] `getPublicUrl(port)` → derive public URL from status + tailnet name.
- [ ] All promise-based with clear error messages (surface "Funnel not enabled" guidance).

**API:**
- [ ] `POST /api/funnel/enable` `{ appId, port }` → enable + set `funnelEnabled=true`, `publicUrl`.
- [ ] `POST /api/funnel/disable` `{ appId, port }` → disable + `funnelEnabled=false`, `publicUrl=null`.
- [ ] `GET /api/funnel/status` → status for all ports.
- [ ] **Startup reconciliation:** on boot, `getFunnelStatus` and sync `apps.json` to actual state (handles out-of-band CLI changes).

**Dashboard:**
- [ ] Per-card "Make Public" toggle: spinner while enabling → show public URL chip + copy button.
- [ ] Toggle OFF → confirm dialog "This will remove public access to [app]".
- [ ] Copy-URL → clipboard + toast.
- [ ] Collapsible **Funnel status panel** at bottom: all funneled apps + URLs + **"Retract All"**.

**Acceptance:** Toggling an app on yields a working `https://…ts.net` URL reachable off-tailnet; toggling off retracts it; `apps.json` and real Funnel state stay reconciled across restarts.

---

### Milestone 5 — Security Guardrails: Password Manager *(Framework §9)*
*Goal: register the first real app and make "never public" enforceable, not just convention.*

- [ ] Register password manager entry (`id: password-manager`, `category: Security`, `funnelEnabled: false`, `publicUrl: null`, `icon: 🔐`).
- [ ] **Hard rule:** any app with `category === "Security"` → Funnel toggle disabled in UI **and** rejected server-side on `/api/funnel/enable`. Defense in depth — UI alone is not enough.
- [ ] Lock icon on Security cards; tooltip "Security apps cannot be made public."

**Acceptance:** Attempting to Funnel a Security app fails both in the UI (disabled) and via a direct API call (server rejects). Password manager shows as private and monitored.

---

### Milestone 6 — MagicDNS & Persistent Service *(Framework Phase 5)*
*Goal: clean private URL + always-on under PM2.*

- [ ] `ecosystem.config.js`: name `tailscale-hub`, `script: server.js`, `watch: false`, env from `.env`, `restart_delay: 3000`, `max_restarts: 10`.
- [ ] Auto-detect Mac hostname (`os.hostname()`); derive `http://<hostname>.<tailnet>:3000`; show as "Your Hub URL" in header with copy button.
- [ ] **Startup health check:** 5s after boot, run checks, log "[Hub] N/M apps online at startup".
- [ ] Document PM2 lifecycle: `pm2 start ecosystem.config.js`, `stop`, `logs`, `pm2 startup` (auto-start on login), `pm2 save`.

**Acceptance:** Hub survives a Mac restart and auto-starts; hub URL is copyable from the header and resolves on iPhone over the tailnet.

---

### Milestone 7 — Docs, Hardening & Reusable Templates *(Framework §10–11)*
*Goal: make it maintainable and repeatable.*

- [ ] **README.md:** clone→run setup, add-an-app, enable/disable Funnel, PM2 reference, iPhone access, troubleshooting.
- [ ] Wire in **troubleshooting fixes proactively** (from framework §10): 401 → Bearer token header; Funnel failure → check Feature Preview + clear UI error; MagicDNS not resolving → show fallback IP in header; health hang → AbortController; apps.json corruption → atomic write; PM2 not auto-starting → `pm2 startup`+`save`; Funnel/apps.json drift → reconcile on boot.
- [ ] **Future-app template** documented: new apps run on their port, expose `GET /health → { status: "ok", app, uptime, timestamp }`, hand back an `apps.json` entry, and (if public) the Funnel command.
- [ ] Standard `/health` endpoint snippet captured in README for every future app to copy.

**Acceptance:** A new app can be registered end-to-end from the README in minutes; common failure modes have documented one-line fixes.

---

## 6. `apps.json` Schema (reference)

```json
{
  "apps": [
    {
      "id": "password-manager",
      "name": "Password Manager",
      "description": "Bitwarden-synced vault — iPhone + Chrome",
      "port": 8080,
      "privateUrl": "http://passwords.<mac>.ts.net:8080",
      "funnelEnabled": false,
      "publicUrl": null,
      "icon": "🔐",
      "category": "Security",
      "addedDate": "2026-06-28"
    }
  ]
}
```

---

## 7. Cross-Cutting Concerns

| Concern | Decision |
|---|---|
| **Secrets** | `TS_API_TOKEN` + `TAILNET` only in `.env` (git-ignored). `.env.example` documents shape. No tokens in code, commits, or PRs. |
| **Tailscale API auth** | `Authorization: Bearer <TS_API_TOKEN>` header. Handle 401 with a clear dashboard message. |
| **Shell exec safety** | `funnel.js` runs `tailscale` CLI; only pass validated integer ports into the command — never interpolate raw user strings into `exec`. |
| **Atomic persistence** | All `apps.json` writes go temp-file→rename. |
| **Resilience** | Health checks time-bounded (5s); Funnel/registry reconciled on boot; PM2 auto-restart. |
| **Security policy** | `category: "Security"` ⇒ Funnel forbidden, enforced **server-side** + UI. |
| **No framework** | Frontend stays vanilla JS for speed/simplicity per the spec. |

---

## 8. Suggested Execution Order (critical path)

`M0 Scaffold → M1 Server+UI → M2 Registry → M3 Health → M4 Funnel → M5 Security guard → M6 PM2/MagicDNS → M7 Docs/hardening`

M3 and M4 are largely independent after M2 and could be parallelized, but the linear order keeps the dashboard demoable at every step.

---

## 9. Decisions (resolved)

1. **Build target:** ✅ This repo *is* the implementation — M0→M7 built here.
2. **Host device:** ✅ **Always-on cloud VM (Linux) joined to the tailnet** — Option B, hosted in the cloud for 24/7 availability while keeping private-by-default tailnet access. Down-alerts are platform-aware (osascript on macOS, `notify-send` on Linux, always logged for `pm2 logs`); PM2 boot-startup documented for systemd + LaunchAgent. See README → *Deploy on a cloud VM*.
3. **App location:** ✅ Apps run **on the hub VM** (localhost ports); `privateUrl` = `http://<vm-hostname>.<tailnet>:<port>`. No multi-node handling needed for now.
4. **App type:** ✅ Apps are **browser-based web apps** (opened on iPhone Safari / Chrome), each exposing the standard `/health` endpoint. (Pure browser extensions are out of scope — they have no port/URL to register.)
5. **Dashboard auth:** ✅ **Tailnet membership** is the access gate — no app-level login. The Funnel guard keeps `Security`-category apps private regardless.

---

*Private by default. Public when you choose. Yours always.*
