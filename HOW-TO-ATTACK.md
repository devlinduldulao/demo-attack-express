# How to run the VaultPay attack demo (step by step)

Complete runbook for **starting the target**, **setting environment variables**, and **running `attack/attack.mjs`**.

| Item | Value |
| --- | --- |
| Target app | Intentionally vulnerable **Express 5** + JWT API |
| Attacker | `demo-attack-express/attack/attack.mjs` (Node 18+, no extra deps) |
| Live example | `https://vaultpay-api.devlinduldulao.workers.dev` |
| Legal | Only attack systems **you own** or have written permission to test |

Related docs: [`README.md`](README.md) · [`EXPRESS-V5.md`](EXPRESS-V5.md) · [`ATTACK-RUN-STUDY.md`](ATTACK-RUN-STUDY.md) · [`server/DEPLOY-CLOUDFLARE.md`](server/DEPLOY-CLOUDFLARE.md)

---

## 0. Prerequisites

1. **Node.js >= 18** (`node -v`)
2. Repo folder: `demo-attack-express/`
3. Install API deps once:

```powershell
cd demo-attack-express/server
npm install
```

4. (Optional) SPA for the “JWT secured” visual:

```powershell
cd demo-attack-express/client
npm install
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

**Node local `.env` example** (optional — Node does not load `.env` automatically unless you use a loader; easiest is session env):

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

**Cloudflare `wrangler.toml` (already in repo):**

```toml
[vars]
JWT_SECRET = "supersecret123"
BODY_LIMIT = "50mb"
NODE_ENV = "production"
```

Optional secret instead of plaintext `[vars]`:

```powershell
cd demo-attack-express/server
npx wrangler secret put JWT_SECRET
# paste: supersecret123
# then remove JWT_SECRET from [vars] in wrangler.toml
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
cd demo-attack-express/client
npm run dev
# Vite proxies /api → http://localhost:4000
```

**Build SPA against live Cloudflare Worker:**

```powershell
cd demo-attack-express/client
$env:VITE_API_URL = "https://vaultpay-api.devlinduldulao.workers.dev"
# Optional project pages:
# $env:VITE_BASE = "/your-repo-name/"
npm run build
# publish client/dist/ to GitHub Pages
```

```bash
# bash
cd demo-attack-express/client
export VITE_API_URL=https://vaultpay-api.devlinduldulao.workers.dev
# export VITE_BASE=/your-repo-name/
npm run build
```

---

### 1.3 Attacker machine (Node running `attack.mjs`)

The attack script takes the **URL as a CLI argument**. It does not require API secrets.

| Variable | Required? | When | Purpose |
| --- | --- | --- | --- |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Sometimes | Zscaler / corporate TLS MITM | Set to `0` if Node fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. **Insecure** — demo laptops only. |
| `NODE_OPTIONS` | No | Rare | e.g. debug; not needed for the demo. |

**Zscaler / Crayon-style laptop (this repo’s known case):**

```powershell
# Node does not trust Zscaler’s intercept cert; Windows PowerShell does.
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

**Examples:**

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

From repo root helper scripts:

```powershell
cd demo-attack-express
npm run attack:local
# or
npm run attack -- https://vaultpay-api.devlinduldulao.workers.dev --drama
```

---

## 3. Path A — Local Node (full attack, easiest)

### Step A1 — Start the API

```powershell
cd demo-attack-express/server

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
# New terminal
Invoke-RestMethod http://localhost:4000/api/health
# expect: ok=true, express=5
```

### Step A3 — (Optional) SPA

```powershell
cd demo-attack-express/client
npm run dev
# open http://localhost:5173
# login: alice@example.com / password123
```

### Step A4 — Attack

```powershell
cd demo-attack-express
node attack/attack.mjs http://localhost:4000 --drama
```

**Expect:** `DEMO RESULT: API PWNED` with ~10 critical (including SSRF self-fetch on localhost).

### Step A5 — Stop

Ctrl+C the server (and Vite if running).

---

## 4. Path B — Local Cloudflare Workers runtime

### Step B1 — Start Wrangler

```powershell
cd demo-attack-express/server
npm install
npm run dev:cf
# Ready on http://127.0.0.1:8787
```

Vars come from `wrangler.toml` `[vars]` (`JWT_SECRET`, `BODY_LIMIT`, `NODE_ENV`).

### Step B2 — Attack

```powershell
cd demo-attack-express
node attack/attack.mjs http://127.0.0.1:8787 --drama
```

No TLS bypass needed (HTTP localhost).

---

## 5. Path C — Live Cloudflare Workers (production demo URL)

### Step C1 — Login (once per machine)

```powershell
cd demo-attack-express/server
npx wrangler login
npx wrangler whoami
```

### Step C2 — Deploy Express 5

```powershell
cd demo-attack-express/server
npm install
npx wrangler deploy
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
cd demo-attack-express

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

Deploy the **`server/`** folder (with `node_modules` or build during deploy).

### Step D2 — Attack

```powershell
# Zscaler laptop only if cert errors:
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"

node attack/attack.mjs https://YOUR-APP.azurewebsites.net --drama
```

### Step D3 — SPA against Azure

```powershell
cd demo-attack-express/client
$env:VITE_API_URL = "https://YOUR-APP.azurewebsites.net"
npm run build
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
# 1) Deploy latest Express 5 (if code changed)
cd C:\Users\DEVDUL\Documents\GitHub\daloy\demo-attack-express\server
npm install
npx wrangler deploy

# 2) Confirm
Invoke-RestMethod https://vaultpay-api.devlinduldulao.workers.dev/api/health

# 3) Optional: open SPA (built with VITE_API_URL pointing at the Worker)
#    Login as Alice for the "JWT secured" visual

# 4) Attack (Zscaler laptop)
cd C:\Users\DEVDUL\Documents\GitHub\daloy\demo-attack-express
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
| Wrangler not logged in | `npx wrangler login` |
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
cd demo-attack-express/server
npm start
```

### Attacker session (live CF + Zscaler)

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
cd demo-attack-express
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama
```

### SPA production build

```powershell
$env:VITE_API_URL = "https://vaultpay-api.devlinduldulao.workers.dev"
# $env:VITE_BASE = "/optional-repo-name/"
cd demo-attack-express/client
npm run build
```

### Clear TLS bypass after the talk

```powershell
Remove-Item Env:NODE_TLS_REJECT_UNAUTHORIZED -ErrorAction SilentlyContinue
```

---

*Educational VaultPay demo only. Do not point the attacker at third-party systems.*
