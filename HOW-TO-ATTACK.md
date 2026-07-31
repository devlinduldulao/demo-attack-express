# How to run the VaultPay attack demo (step by step)

Complete runbook for **starting the target**, **setting environment variables**, and **running `attack/attack.mjs`**.

| Item | Value |
| --- | --- |
| Target app | Intentionally vulnerable **Express 5** + JWT API |
| Attacker | `attack/attack.mjs` (Node 18+, no extra deps) |
| Live example | `https://vaultpay-api.devlinduldulao.workers.dev` |
| Frontend | **None** — attack hits the API URL directly |
| Legal | Only attack systems **you own** or have written permission to test |

Related docs: [`README.md`](README.md) · [`EXPRESS-V5.md`](EXPRESS-V5.md) · [`ATTACK-RUN-STUDY.md`](ATTACK-RUN-STUDY.md) · [`CLOUDFLARE-VS-APP-SECURITY.md`](CLOUDFLARE-VS-APP-SECURITY.md) · [`server/DEPLOY-CLOUDFLARE.md`](server/DEPLOY-CLOUDFLARE.md)

All commands assume you are at the **repository root** (folder with `server/`, `attack/`, `tests/`), unless a step says `cd server`.

---

## 0. Prerequisites

1. **Node.js >= 18** (`node -v`)
2. Clone or open **this repo**
3. Install API deps once:

```powershell
cd server
npm install
cd ..
```

4. Attack script needs **no** `npm install` (uses built-in `fetch` + `crypto`).

---

## 1. Environment variables (complete list)

### 1.1 Server (Express API)

Set these when running **Node** (`npm start`) or in Azure App Service **Application settings**.  
Cloudflare uses `wrangler.toml` `[vars]` (and optional `wrangler secret`) instead of a `.env` file.

| Variable | Required? | Default | Where | Purpose |
| --- | --- | --- | --- | --- |
| `PORT` | No | `4000` | Node / Azure | HTTP listen port. Azure sets this automatically. |
| `JWT_SECRET` | No | `supersecret123` | Node / Azure / CF vars | Weak signing secret (demo on purpose). |
| `BODY_LIMIT` | No | `50mb` | Node / Azure / CF vars | Max JSON body size (huge = intentional). |
| `NODE_ENV` | No | `development` if unset | Node / Azure / CF vars | Shown in `/api/debug/config`. Use `production` on deploy. |
| `CF_WORKER` | Auto | set by `worker.mjs` | Cloudflare only | Marks runtime as `cloudflare-workers` in debug config. |
| `RUNTIME` | No | `node` | Any | Optional override for debug `runtime` label. |

**Node local session env** (optional — defaults already work):

```powershell
$env:PORT = "4000"
$env:JWT_SECRET = "supersecret123"
$env:BODY_LIMIT = "50mb"
$env:NODE_ENV = "development"
```

```bash
export PORT=4000
export JWT_SECRET=supersecret123
export BODY_LIMIT=50mb
export NODE_ENV=development
```

**Cloudflare `server/wrangler.toml`:**

```toml
[vars]
JWT_SECRET = "supersecret123"
BODY_LIMIT = "50mb"
NODE_ENV = "production"
```

Optional secret:

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
| `PORT` | (set by platform) |
| `JWT_SECRET` | `supersecret123` |
| `BODY_LIMIT` | `50mb` |
| `NODE_ENV` | `production` |
| Startup command | `node server.js` or `npm start` |

---

### 1.2 Attacker machine (Node running `attack.mjs`)

The attack script takes the **URL as a CLI argument**. It does not require API secrets.

| Variable | Required? | When | Purpose |
| --- | --- | --- | --- |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Sometimes | Zscaler / corporate TLS MITM | Set to `0` if Node fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. **Insecure** — demo laptops only. |

**Zscaler / corporate TLS-intercept laptop:**

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama
```

```bash
export NODE_TLS_REJECT_UNAUTHORIZED=0
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama
```

**Clean network:** leave that variable **unset**.

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
| `--skip-flood` | Skip 40 parallel login burst |
| `--skip-slow` | Skip `/api/slow?ms=3000` |

**Examples** (from repo root):

```powershell
node attack/attack.mjs http://localhost:4000
node attack/attack.mjs http://127.0.0.1:8787
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"   # only if TLS intercept
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --skip-flood --skip-slow --json
```

Root helpers (if present):

```powershell
npm run attack:local
npm run attack -- https://vaultpay-api.devlinduldulao.workers.dev --drama
```

---

## 3. Path A — Local Node

### A1 — Start the API

```powershell
cd server
$env:PORT = "4000"
$env:JWT_SECRET = "supersecret123"
$env:BODY_LIMIT = "50mb"
$env:NODE_ENV = "development"
npm start
```

Wait for: `Listening on http://localhost:4000` / `Express: 5.x`

### A2 — Smoke check

```powershell
Invoke-RestMethod http://localhost:4000/api/health
# expect: ok=true, express=5
```

### A3 — Attack

```powershell
# Repo root
node attack/attack.mjs http://localhost:4000 --drama
```

**Expect:** `DEMO RESULT: API PWNED` (~10 critical on localhost, including SSRF self-fetch).

### A4 — Stop

Ctrl+C the server.

---

## 4. Path B — Local Cloudflare Workers runtime

### B1 — Start Wrangler

```powershell
cd server
npm install
npm run dev:cf
# Ready on http://127.0.0.1:8787
```

### B2 — Attack

```powershell
# Repo root
node attack/attack.mjs http://127.0.0.1:8787 --drama
```

No TLS bypass needed (HTTP).

---

## 5. Path C — Live Cloudflare Workers

### C1 — Login (once)

```powershell
cd server
npx wrangler login
npx wrangler whoami
cd ..
```

### C2 — Deploy

```powershell
cd server
npm install
npx wrangler deploy
cd ..
```

URL example: `https://vaultpay-api.devlinduldulao.workers.dev`

### C3 — Confirm Express 5

```powershell
Invoke-RestMethod https://vaultpay-api.devlinduldulao.workers.dev/api/health
# expect: "express": "5"
```

### C4 — Attack

```powershell
# ONLY if Node certificate errors (Zscaler / corporate MITM):
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"

node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama
```

Soft run:

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama --skip-flood
```

### C5 — Cloudflare vs local Node

| Probe | Local Node | Cloudflare Workers |
| --- | --- | --- |
| Unauth dump / IDOR / debug secret | CRITICAL | CRITICAL |
| Path traversal secret | CRITICAL | CRITICAL |
| BOLA / mass assign / forge admin | CRITICAL | CRITICAL |
| Login flood no 429 | HIGH | HIGH (usually) |
| 1.5 MiB body | HIGH | HIGH |
| Open redirect | HIGH | HIGH |
| SSRF self-fetch | Often CRITICAL | Often **CF 1042** |
| XSS `onerror=alert` | HIGH | Often **WAF 403** |
| Raw TCP | HTTP only | **Skipped** (HTTPS) |

Study: [`ATTACK-RUN-STUDY.md`](ATTACK-RUN-STUDY.md).

---

## 6. Path D — Azure App Service

### D1 — App settings

| Name | Value |
| --- | --- |
| `JWT_SECRET` | `supersecret123` |
| `BODY_LIMIT` | `50mb` |
| `NODE_ENV` | `production` |
| Startup | `node server.js` |

Deploy **`server/`** only.

### D2 — Attack

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"   # if cert errors
node attack/attack.mjs https://YOUR-APP.azurewebsites.net --drama
```

---

## 7. Demo credentials (seed data)

| Email | Password | Role |
| --- | --- | --- |
| `alice@example.com` | `password123` | user |
| `bob@example.com` | `bobsecret` | user |
| `admin@vaultpay.demo` | `admin123` | admin |

Used automatically by the attacker. Default JWT secret: `supersecret123`.

---

## 8. Phase order

| # | Phase | Needs login? |
| --- | --- | --- |
| 01 | Recon health + route map | No |
| 02 | Missing security headers | No |
| 03 | Oversized JSON body | No |
| 04 | Login flood | No |
| 05 | Path traversal → secrets | No |
| 06 | Open redirect | No |
| 07 | Open proxy / SSRF | No |
| 08 | Stack leak + XSS echo | No |
| 09 | Slow handler | No |
| 10 | User dump / IDOR / debug / search | No |
| 11 | Login error enumeration | No |
| 12 | Login, BOLA, mass assign, admin, forge JWT | Yes (auto) |
| 13 | Unauth settings write | No |
| 14 | Raw TCP (HTTP only) | No |

---

## 9. Talk-day checklist

```powershell
# Repo root (server/ + attack/)

# 1) Deploy if code changed
cd server
npm install
npx wrangler deploy
cd ..

# 2) Confirm
Invoke-RestMethod https://vaultpay-api.devlinduldulao.workers.dev/api/health

# 3) Optional: open / or /api/health in a browser for the audience

# 4) Attack (Zscaler only if cert errors)
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama

# 5) End on: DEMO RESULT: API PWNED
```

---

## 10. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `fetch failed` / `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` | `$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"` |
| Connection refused | API not running; wrong URL; hit `/api/health` first |
| Wrangler not logged in | `cd server; npx wrangler login` |
| Few findings | Wrong host / WAF / not this demo |
| SSRF not CRITICAL on Workers | Expected CF `1042` on self-fetch |
| XSS not CRITICAL on Workers | Expected WAF `403` |
| Flood flaky | `--skip-flood` |
| `express` not 5 after deploy | Redeploy after `npm install` with `express@^5.2.1` |

---

## 11. Copy-paste env blocks

### Local Node server

```powershell
$env:PORT = "4000"
$env:JWT_SECRET = "supersecret123"
$env:BODY_LIMIT = "50mb"
$env:NODE_ENV = "development"
cd server
npm start
```

### Attacker (live CF + Zscaler)

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama
```

### Clear TLS bypass after the talk

```powershell
Remove-Item Env:NODE_TLS_REJECT_UNAUTHORIZED -ErrorAction SilentlyContinue
```

---

*Educational VaultPay demo only. API + attack script; no frontend. Do not attack third-party systems.*
