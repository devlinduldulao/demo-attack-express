# How to run the VaultPay attack demo (step by step)

Complete runbook for **starting the target**, **setting environment variables**, and **running `attack/attack.mjs`**.

| Item | Value |
| --- | --- |
| Target app | Intentionally vulnerable **Express 5** + JWT API |
| Attacker | `attack/attack.mjs` (Node 18+; API package pins Node >= 24) |
| Live examples | CF: `https://vaultpay-api.devlinduldulao.workers.dev` · Vercel: `https://vaultpay-api.vercel.app` |
| Frontend | **None** — attack hits the API URL directly |
| Legal | Only attack systems **you own** or have written permission to test |

Related docs: [`README.md`](README.md) · [`TALK.md`](TALK.md) · [`TEARDOWN.md`](TEARDOWN.md) · [`EXPRESS-V5.md`](EXPRESS-V5.md) · [`ATTACK-RUN-CLOUDFLARE.md`](ATTACK-RUN-CLOUDFLARE.md) · [`ATTACK-RUN-VERCEL.md`](ATTACK-RUN-VERCEL.md) · [`PLATFORM-COMPARISON.md`](PLATFORM-COMPARISON.md) · [`CLOUDFLARE-VS-APP-SECURITY.md`](CLOUDFLARE-VS-APP-SECURITY.md) · [`server/DEPLOY-CLOUDFLARE.md`](server/DEPLOY-CLOUDFLARE.md) · [`server/DEPLOY-VERCEL.md`](server/DEPLOY-VERCEL.md)

All commands assume you are at the **repository root** (folder with `server/`, `attack/`, `scripts/`), unless a step says `cd server`.

---

## 0. Prerequisites

1. **Node.js >= 24** for the API (`server/package.json` engines); attacker script needs modern Node with `fetch` (18+)
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
| `BODY_LIMIT` | No | `50mb` | Node / Azure / CF vars | Max JSON body size (**misconfig** for demo — Express `json()` default is 100kb). |
| `NODE_ENV` | No | `development` if unset | Node / Azure / CF vars | Shown in `/api/debug/config`. Use `production` on deploy. |
| `DEMO_GATE_TOKEN` | Recommended on public deploys | unset (open) | Node / Azure / CF secret / Vercel env | When set, every request needs header `X-VaultPay-Demo: <token>` or gets 404. See [`TEARDOWN.md`](TEARDOWN.md). |
| `DEMO_RESET_TOKEN` | No | unset | Any | If set, `POST /api/demo/reset` requires `X-VaultPay-Reset`. |
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

The attack script takes the **URL as a CLI argument**. It does not require API secrets
unless the target has `DEMO_GATE_TOKEN` enabled.

| Variable | Required? | When | Purpose |
| --- | --- | --- | --- |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Sometimes | Zscaler / corporate TLS MITM | Set to `0` if Node fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. **Insecure** — demo laptops only. |
| `DEMO_GATE_TOKEN` | When server is gated | Public gated deploys | Same value as server; alternatively pass `--gate=TOKEN`. |

**Zscaler / corporate TLS-intercept laptop:**

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev
```

```bash
export NODE_TLS_REJECT_UNAUTHORIZED=0
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev
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
| `--drama` | **Wait for Enter** between phases (stage pacing) |
| `--projector` | No dim text; less wire noise (large rooms) |
| `--reset` | `POST /api/demo/reset` before recon (warm isolate hygiene) |
| `--gate=TOKEN` | Send `X-VaultPay-Demo` header (or set `DEMO_GATE_TOKEN` env) |
| `--verbose` | Print response body previews on more requests |
| `--quiet` | Less color; hide per-request wire traces |
| `--json` | Print machine-readable findings after the report |
| `--skip-flood` | Skip 40 parallel login burst |
| `--skip-slow` | Skip `/api/slow?ms=3000` |
| `--internal=URL` | Base URL of the SSRF stand-in internal service (or `INTERNAL_SERVICE_URL`). `npm run demo` sets this for you. |

**Talk / terminal demo:**

```powershell
# Stage: Enter between phases
node attack/attack.mjs https://vaultpay-api.vercel.app --drama --reset
# Fast continuous (no Enter)
node attack/attack.mjs https://vaultpay-api.vercel.app --reset --skip-flood
# Local one-shot
npm run demo
```

`--reset` re-seeds the in-memory DB so a warm isolate does not keep “Hijacked Bob” from a prior run.

Findings are tagged `framework-gap` | `misconfig` | `app-code` plus OWASP API ids.
The engagement report prints a **Whose fault?** block: `misconfig` = demo app/env (CORS `*`, `BODY_LIMIT`, stack leak) — **not** Express defaults and **not** Cloudflare/Vercel inventing them. Same three misconfigs appear on both cloud URLs; only `◇ PLATFORM` differs by host.
See [`TALK.md`](TALK.md) for narration and [`CLOUDFLARE-VS-APP-SECURITY.md`](CLOUDFLARE-VS-APP-SECURITY.md#whose-fault-cloud-deploy-honesty) for the cloud blame matrix.

Raw terminal captures (`ATTACK-RUN-*-LATEST.log`) are **gitignored** local artifacts. Re-run with `--json` after deploy if you need a fresh log with current labels.

**Examples** (from repo root):

```powershell
node attack/attack.mjs http://localhost:4000 --drama --reset
node attack/attack.mjs http://127.0.0.1:8787 --drama
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"   # only if TLS intercept
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama --reset
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama --reset --gate=talk-day-secret
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --skip-flood --skip-slow --json
```

Root helpers (if present):

```powershell
npm run attack:local
npm run attack -- https://vaultpay-api.devlinduldulao.workers.dev
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
node attack/attack.mjs http://localhost:4000
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
node attack/attack.mjs http://127.0.0.1:8787
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

node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev
```

Soft run:

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --skip-flood
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

Study: [`ATTACK-RUN-CLOUDFLARE.md`](ATTACK-RUN-CLOUDFLARE.md).

---

## 6. Path D — Live Vercel serverless

### D1 — Login (once)

```powershell
cd server
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"   # if cert errors
vercel whoami
cd ..
```

### D2 — Deploy from local machine

```powershell
cd server
npm install
vercel --prod --yes
cd ..
```

Alias example: `https://vaultpay-api.vercel.app`  
Private GitHub is **not** required (CLI uploads from disk).

### D3 — Confirm

```powershell
Invoke-RestMethod https://vaultpay-api.vercel.app/api/health
# expect: express=5
```

### D4 — Attack

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"   # if needed
node attack/attack.mjs https://vaultpay-api.vercel.app
```

### D5 — What differs from Cloudflare

| Probe | Cloudflare | Vercel |
| --- | --- | --- |
| SSRF to own debug URL | Often **1042** blocked | Often **works** (CRITICAL) |
| Mild HTML XSS sink | Works | Works |
| Noisy XSS | Often WAF 403 | Mild payload enough |
| HSTS | Often missing | Often **present** |
| Authz / PII dump | Still pwned | Still pwned |

Full study: [`ATTACK-RUN-VERCEL.md`](ATTACK-RUN-VERCEL.md) · deploy: [`server/DEPLOY-VERCEL.md`](server/DEPLOY-VERCEL.md).

---

## 7. Path E — Azure App Service

### E1 — App settings

| Name | Value |
| --- | --- |
| `JWT_SECRET` | `supersecret123` |
| `BODY_LIMIT` | `50mb` |
| `NODE_ENV` | `production` |
| Startup | `node server.js` |

Deploy **`server/`** only.

### E2 — Attack

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"   # if cert errors
node attack/attack.mjs https://YOUR-APP.azurewebsites.net
```

---

## 8. Demo credentials (seed data)

| Email | Password | Role |
| --- | --- | --- |
| `alice@example.com` | `password123` | user |
| `bob@example.com` | `bobsecret` | user |
| `admin@vaultpay.demo` | `admin123` | admin |

Used automatically by the attacker. Default JWT secret: `supersecret123`.

---

## 9. Phase order

Numbers shift by one when `--reset` is on (it adds phase 01).

| # | Phase | Needs login? |
| --- | --- | --- |
| 01 | Demo reset (only with `--reset`) | No |
| 02 | Recon health + route map | No |
| 03 | Missing security headers + `x-powered-by` | No |
| 04 | CORS misconfig | No |
| 05 | Oversized JSON body | No |
| 06 | Login flood | No |
| 07 | Path traversal → secrets | No |
| 08 | Open redirect | No |
| 09 | Open proxy / SSRF — self, external, IMDS, **internal pivot**, **redirect hop** | No |
| 10 | Stack leak + XSS echo | No |
| 11 | Slow handler | No |
| 12 | User dump / IDOR / debug / search | No |
| 13 | Login error enumeration | No |
| 14 | Unauth settings write | No |
| 16 | Raw TCP (HTTP only) | No |
| 17 | Login, BOLA, mass assign, admin, `alg:none`, forge JWT | Yes (auto) |

The SSRF internal-pivot and redirect-hop probes only run when `--internal=URL`
is set (automatic under `npm run demo`).

---

## 10. Talk-day checklist

```powershell
# Repo root (server/ + attack/)
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"   # Zscaler if needed

# 1) Deploy if code changed
cd server
npm install
npx wrangler deploy
vercel --prod --yes
cd ..

# 2) Confirm both clouds
Invoke-RestMethod https://vaultpay-api.devlinduldulao.workers.dev/api/health
Invoke-RestMethod https://vaultpay-api.vercel.app/api/health

# 3) Attack both (optional: one is enough on stage)
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev
node attack/attack.mjs https://vaultpay-api.vercel.app

# 4) Show PLATFORM-COMPARISON.md or CLOUDFLARE-VS-APP-SECURITY.md
# 5) End on: DEMO RESULT: API PWNED
```

---

## 11. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `fetch failed` / `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` | `$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"` |
| Connection refused | API not running; wrong URL; hit `/api/health` first |
| Wrangler not logged in | `cd server; npx wrangler login` |
| Vercel not logged in | `cd server; vercel login` |
| Few findings | Wrong host / WAF / not this demo |
| SSRF not CRITICAL on Workers | Expected CF `1042` on self-fetch — try Vercel URL for full SSRF |
| XSS not CRITICAL on Workers | Expected WAF `403` on noisy payloads — mild HTML still proves sink |
| Flood flaky | `--skip-flood` |
| Mass-assign 404 on Vercel | Use latest attacker (seed users Alice/Bob); multi-instance RAM |
| `express` not 5 after deploy | Redeploy after `npm install` with `express@^5.2.1` |

---

## 12. Copy-paste env blocks

### Local Node server

```powershell
$env:PORT = "4000"
$env:JWT_SECRET = "supersecret123"
$env:BODY_LIMIT = "50mb"
$env:NODE_ENV = "development"
cd server
npm start
```

### Attacker (live CF or Vercel + Zscaler)

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev
node attack/attack.mjs https://vaultpay-api.vercel.app
```

### Clear TLS bypass after the talk

```powershell
Remove-Item Env:NODE_TLS_REJECT_UNAUTHORIZED -ErrorAction SilentlyContinue
```

---

*Educational VaultPay demo only. API + attack script; no frontend. Do not attack third-party systems.*
