# How to run the VaultPay attack demo (step by step)

Complete runbook for **starting the target**, **setting environment variables**, and **running `attack/attack.mjs`**.

| Item | Value |
| --- | --- |
| Target app | Intentionally vulnerable **Express 5** + JWT API |
| Attacker | `attack/attack.mjs` (Node 18+, no extra deps) |
| Live example | `https://vaultpay-api.devlinduldulao.workers.dev` |
| Legal | Only attack systems **you own** or have written permission to test |

Related docs: [`README.md`](README.md) · [`EXPRESS-V5.md`](EXPRESS-V5.md) · [`ATTACK-RUN-STUDY.md`](ATTACK-RUN-STUDY.md) · [`server/DEPLOY-CLOUDFLARE.md`](server/DEPLOY-CLOUDFLARE.md)

All commands below assume you are at the **repository root** of this project (the folder that contains `server/`, `client/`, and `attack/`), unless a step says `cd server` or `cd client`.

---

## 0. Prerequisites

1. **Node.js >= 18** (`node -v`)
2. Clone or open **this repo** (standalone; not nested under another monorepo)
3. Install API deps once:

```powershell
cd server
npm install
cd ..
```

4. (Optional) SPA for the “JWT secured” visual:

```powershell
cd client
npm install
cd ..
```

5. Attack script needs **no** `npm install` (uses built-in `fetch` + `crypto`).

---

## 1. Environment variables (complete list)

### 1.1 Server (Express API)

Set these when running **Node** (`npm start`) or in Azure App Service **Application settings**.  
Cloudflare uses `wrangler.toml` `[vars]` (and optional `wrangler secret`) instead of a `.env` file.

| Variable | Required? | Default | Where | Purpose |
| --- | --- | --- | --- | --- |
| `PORT` | No | `4000` | Node / Azure | HTTP listen port. Azure sets this automatically. |
| `JWT_SECRET` | No | `supersecret123` | Node / Azure / CF vars | Weak signing secret (demo on purpose). |
| `BODY_LIMIT` | No | `50mb` | Node / Azure / CF vars | Max JSON body size for the demo parser (huge = intentional). |
| `NODE_ENV` | No | `development` if unset | Node / Azure / CF vars | Shown in `/api/debug/config`. Use `production` on deploy. |
| `CF_WORKER` | Auto | set by `worker.mjs` | Cloudflare only | Marks runtime as `cloudflare-workers` in debug config. |
| `RUNTIME` | No | `node` | Any | Optional override for debug `runtime` label. |

**Node local session env** (optional — defaults already work for the demo):

```powershell
# PowerShell (current terminal only)
$env:PORT = "4000"
$env:JWT_SECRET = "supersecret123"
$env:BODY_LIMIT = "50mb"
$env:NODE_ENV = "development"
```

```bash
# bash
export PORT=4000
export JWT_SECRET=supersecret123
export BODY_LIMIT=50mb
export NODE_ENV=development
```

**Cloudflare `server/wrangler.toml` (already in repo):**

```toml
[vars]
JWT_SECRET = "supersecret123"
BODY_LIMIT = "50mb"
NODE_ENV = "production"
```

Optional secret instead of plaintext `[vars]`:

```powershell
cd server
npx wrangler secret put JWT_SECRET
# paste: supersecret123
# then remove JWT_SECRET from [vars] in wrangler.toml
cd ..
```

**Azure App Service application settings:**

| Name | Value |
| --- | --- |
| `PORT` | (set by platform; do not hardcode) |
| `JWT_SECRET` | `supersecret123` |
| `BODY_LIMIT` | `50mb` |
| `NODE_ENV` | `production` |
| Startup command | `node server.js` or `npm start` |

---

### 1.2 Client (React SPA, build-time only)

Vite inlines these at **build** time (not runtime).

| Variable | Required? | Default | Purpose |
| --- | --- | --- | --- |
| `VITE_API_URL` | Yes for Pages → remote API | empty (same origin / Vite proxy) | Absolute API base, no trailing slash. |
| `VITE_BASE` | Only for project Pages | `./` | e.g. `/my-repo/` for `username.github.io/my-repo/` |

**Local SPA + local API (proxy, no env needed):**

```powershell
cd client
npm run dev
# Vite proxies /api → http://localhost:4000
# open http://localhost:5173
```

**Build SPA against live Cloudflare Worker:**

```powershell
cd client
$env:VITE_API_URL = "https://vaultpay-api.devlinduldulao.workers.dev"
# Optional project pages:
# $env:VITE_BASE = "/your-repo-name/"
npm run build
# publish client/dist/ to GitHub Pages
cd ..
```

```bash
# bash
cd client
export VITE_API_URL=https://vaultpay-api.devlinduldulao.workers.dev
# export VITE_BASE=/your-repo-name/
npm run build
cd ..
```

---

### 1.3 Attacker machine (Node running `attack.mjs`)

The attack script takes the **URL as a CLI argument**. It does not require API secrets.

| Variable | Required? | When | Purpose |
| --- | --- | --- | --- |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Sometimes | Zscaler / corporate TLS MITM | Set to `0` if Node fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. **Insecure** — demo laptops only. |
| `NODE_OPTIONS` | No | Rare | e.g. debug; not needed for the demo. |

**Zscaler / corporate TLS-intercept laptop:**

```powershell
# Node does not trust the intercept CA; Windows PowerShell often does.
# Only for attacking YOUR demo host from this machine:
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"

node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama
```

```bash
export NODE_TLS_REJECT_UNAUTHORIZED=0
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama
```

**Clean network (home / non-intercepted TLS):** leave `NODE_TLS_REJECT_UNAUTHORIZED` **unset**.

```powershell
Remove-Item Env:NODE_TLS_REJECT_UNAUTHORIZED -ErrorAction SilentlyContinue
```

---

## 2. Attack script CLI

```text
node attack/attack.mjs <API_BASE_URL> [flags]
```

| Flag | Meaning |
| --- | --- |
| (none) | Full run: wire logs on, flood on, slow probe on |
| `--drama` | Pause between phases (best for projector talks) |
| `--verbose` | Print response body previews on more requests |
| `--quiet` | Less color; hide per-request wire traces |
| `--json` | Print machine-readable findings after the report |
| `--skip-flood` | Skip 40 parallel login burst (gentler on free tiers) |
| `--skip-slow` | Skip `/api/slow?ms=3000` |

**Examples** (from repo root):

```powershell
# Local Node API
node attack/attack.mjs http://localhost:4000

# Local Wrangler
node attack/attack.mjs http://127.0.0.1:8787

# Live Cloudflare (talk mode)
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"   # only if TLS intercept
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama

# Soft + capture JSON summary
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --skip-flood --skip-slow --json
```

If root `package.json` defines helper scripts:

```powershell
npm run attack:local
# or
npm run attack -- https://vaultpay-api.devlinduldulao.workers.dev --drama
```

---

## 3. Path A — Local Node (full attack, easiest)

### Step A1 — Start the API

```powershell
cd server

# Optional env (defaults work for the demo)
$env:PORT = "4000"
$env:JWT_SECRET = "supersecret123"
$env:BODY_LIMIT = "50mb"
$env:NODE_ENV = "development"

npm start
```

Wait for:

```text
Listening on http://localhost:4000
Express:     5.x
```

### Step A2 — Smoke check

```powershell
# New terminal (repo root or anywhere)
Invoke-RestMethod http://localhost:4000/api/health
# expect: ok=true, express=5
```

### Step A3 — (Optional) SPA

```powershell
# New terminal, repo root
cd client
npm run dev
# open http://localhost:5173
# login: alice@example.com / password123
```

### Step A4 — Attack

```powershell
# New terminal, repo root
node attack/attack.mjs http://localhost:4000 --drama
```

**Expect:** `DEMO RESULT: API PWNED` with ~10 critical (including SSRF self-fetch on localhost).

### Step A5 — Stop

Ctrl+C the server (and Vite if running).

---

## 4. Path B — Local Cloudflare Workers runtime

### Step B1 — Start Wrangler

```powershell
cd server
npm install
npm run dev:cf
# Ready on http://127.0.0.1:8787
```

Vars come from `server/wrangler.toml` `[vars]` (`JWT_SECRET`, `BODY_LIMIT`, `NODE_ENV`).

### Step B2 — Attack

```powershell
# New terminal, repo root
node attack/attack.mjs http://127.0.0.1:8787 --drama
```

No TLS bypass needed (HTTP localhost).

---

## 5. Path C — Live Cloudflare Workers (production demo URL)

### Step C1 — Login (once per machine)

```powershell
cd server
npx wrangler login
npx wrangler whoami
cd ..
```

### Step C2 — Deploy Express 5

```powershell
cd server
npm install
npx wrangler deploy
cd ..
```

Note the printed URL, e.g.:

```text
https://vaultpay-api.devlinduldulao.workers.dev
```

### Step C3 — Confirm Express 5 is live

```powershell
Invoke-RestMethod https://vaultpay-api.devlinduldulao.workers.dev/api/health
# expect: "express": "5"
```

### Step C4 — Attack (with env if needed)

```powershell
# Repo root

# ONLY if Node fails with certificate errors (Zscaler / corporate MITM):
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"

node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama
```

**Talk-friendly soft run:**

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama --skip-flood
```

### Step C5 — What to expect on Cloudflare vs local Node

| Probe | Local Node | Cloudflare Workers |
| --- | --- | --- |
| Unauth user dump / IDOR / debug secret | CRITICAL | CRITICAL |
| Path traversal secret | CRITICAL | CRITICAL |
| BOLA / mass assign / forge admin | CRITICAL | CRITICAL |
| Login flood no 429 | HIGH | HIGH (usually) |
| 1.5 MiB body accepted | HIGH | HIGH |
| Open redirect | HIGH | HIGH |
| SSRF self-fetch to same workers.dev | Often CRITICAL | Often **CF error 1042** (no CRITICAL) |
| XSS `onerror=alert` | HIGH | Often **WAF 403** (not app-defended) |
| Raw TCP header probes | HTTP only | **Skipped** (HTTPS) |

Study of a real live run: [`ATTACK-RUN-STUDY.md`](ATTACK-RUN-STUDY.md).

---

## 6. Path D — Azure App Service API + attack

### Step D1 — Configure app settings

| Name | Value |
| --- | --- |
| `JWT_SECRET` | `supersecret123` |
| `BODY_LIMIT` | `50mb` |
| `NODE_ENV` | `production` |
| Startup | `node server.js` |

Deploy the **`server/`** folder (with `node_modules` or SCM build during deploy).

### Step D2 — Attack

```powershell
# Repo root
# Zscaler laptop only if cert errors:
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"

node attack/attack.mjs https://YOUR-APP.azurewebsites.net --drama
```

### Step D3 — SPA against Azure

```powershell
cd client
$env:VITE_API_URL = "https://YOUR-APP.azurewebsites.net"
npm run build
cd ..
```

---

## 7. Demo credentials (seed data)

| Email | Password | Role |
| --- | --- | --- |
| `alice@example.com` | `password123` | user |
| `bob@example.com` | `bobsecret` | user |
| `admin@vaultpay.demo` | `admin123` | admin |

Attacker script also tries these automatically; it does **not** need you to log in first for most damage (unauth phases run first).

Default JWT secret (demo): `supersecret123`.

---

## 8. Phase order (what the script does)

Use this while watching the console:

| # | Phase | Needs login? |
| --- | --- | --- |
| 01 | Recon health + route map | No |
| 02 | Missing security headers | No |
| 03 | Oversized JSON body | No |
| 04 | Login flood (no 429) | No |
| 05 | Path traversal → secrets | No |
| 06 | Open redirect | No |
| 07 | Open proxy / SSRF | No |
| 08 | Stack leak + XSS echo | No |
| 09 | Slow handler timeout | No |
| 10 | User dump / IDOR / debug / search | No |
| 11 | Login error enumeration | No |
| 12 | Login, BOLA, mass assign, admin, forge JWT | Yes (demo accounts) |
| 13 | Unauth settings write | No |
| 14 | Raw TCP (HTTP only) | No |

---

## 9. One-page “talk day” checklist

```powershell
# From this repository root (folder with server/, client/, attack/)

# 1) Deploy latest Express 5 (if code changed)
cd server
npm install
npx wrangler deploy
cd ..

# 2) Confirm
Invoke-RestMethod https://vaultpay-api.devlinduldulao.workers.dev/api/health

# 3) Optional: open SPA (built with VITE_API_URL pointing at the Worker)
#    Login as Alice for the "JWT secured" visual

# 4) Attack (Zscaler laptop only if cert errors)
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama

# 5) End on: DEMO RESULT: API PWNED
```

---

## 10. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `fetch failed` / `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` | `$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"` (corporate TLS). Or install org root CA into Node. |
| `Cannot reach` / connection refused | API not running; wrong URL/port; cold start — hit `/api/health` first. |
| Wrangler not logged in | `cd server; npx wrangler login` |
| Health works but SPA cannot call API | Rebuild SPA with correct `VITE_API_URL`; check CORS (demo uses `*`). |
| Attack shows few findings | Wrong host; WAF in front; not the VaultPay demo. |
| SSRF not CRITICAL on Workers | Expected CF `1042` on self-fetch — see study guide. |
| XSS not CRITICAL on Workers | Expected WAF `403` — not Express fixing HTML. |
| Flood flaky on free tier | Add `--skip-flood`. |
| `express` not 5 after deploy | Redeploy from `server/` after `npm install` with `express@^5.2.1`. |

---

## 11. Copy-paste env blocks

### Local Node server session

```powershell
$env:PORT = "4000"
$env:JWT_SECRET = "supersecret123"
$env:BODY_LIMIT = "50mb"
$env:NODE_ENV = "development"
cd server
npm start
```

### Attacker session (live CF + Zscaler)

```powershell
# Repo root
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama
```

### SPA production build

```powershell
$env:VITE_API_URL = "https://vaultpay-api.devlinduldulao.workers.dev"
# $env:VITE_BASE = "/optional-repo-name/"
cd client
npm run build
cd ..
```

### Clear TLS bypass after the talk

```powershell
Remove-Item Env:NODE_TLS_REJECT_UNAUTHORIZED -ErrorAction SilentlyContinue
```

---

*Educational VaultPay demo only. Do not point the attacker at third-party systems.*
