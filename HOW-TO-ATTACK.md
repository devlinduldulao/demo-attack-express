# How to run the VaultPay attack demo (step by step)

Complete runbook for **starting the target**, **setting environment variables**, and **running the attack scripts**.

| Item | Value |
| --- | --- |
| Target app | Intentionally vulnerable **Express 5** + JWT API (`server/`) |
| Second target | The same app rebuilt on **DaloyJS** with the same mistakes (`server-daloy/`, laptop only) |
| Attacker, full | `attack/attack.mjs` — 16 phases, the 30–45 minute talk |
| Attacker, short | `attack/attackv2.mjs` — 7 phases, the 10 minute slot; works on both targets |
| Before / after | `npm run compare` — Express vs DaloyJS vs DaloyJS + opt-ins in one table |
| Node | Attack scripts need Node 18+; both API packages pin Node >= 26 |
| Live examples | CF: `https://vaultpay-api.devlinduldulao.workers.dev` · Vercel: `https://vaultpay-api.vercel.app` |
| Frontend | **None** — attack hits the API URL directly |
| Legal | Only attack systems **you own** or have written permission to test |

Related docs: [`README.md`](README.md) · [`TALK.md`](TALK.md) · [`TEARDOWN.md`](TEARDOWN.md) · [`EXPRESS-V5.md`](EXPRESS-V5.md) · [`ATTACK-RUN-CLOUDFLARE.md`](ATTACK-RUN-CLOUDFLARE.md) · [`ATTACK-RUN-VERCEL.md`](ATTACK-RUN-VERCEL.md) · [`PLATFORM-COMPARISON.md`](PLATFORM-COMPARISON.md) · [`CLOUDFLARE-VS-APP-SECURITY.md`](CLOUDFLARE-VS-APP-SECURITY.md) · [`server/DEPLOY-CLOUDFLARE.md`](server/DEPLOY-CLOUDFLARE.md) · [`server/DEPLOY-VERCEL.md`](server/DEPLOY-VERCEL.md) · [`server-daloy/README.md`](server-daloy/README.md)

All commands assume you are at the **repository root** (folder with `server/`, `attack/`, `scripts/`), unless a step says `cd server`.

---

## 0. Prerequisites

1. **Node.js >= 26** for the API (`server/package.json` engines); attacker script needs modern Node with `fetch` (18+)
2. Clone or open **this repo**
3. Install API deps once (both builds):

```powershell
npm run install:all
# Express build only:  npm install --prefix server
```

4. The attack scripts need **no** `npm install` (built-in `fetch` + `crypto`).

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

### 1.2 Server (DaloyJS build, `server-daloy/`)

| Variable | Required? | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | No | `4100` | HTTP listen port. |
| `JWT_SECRET` | No | a 53-character demo key, hard-coded | HS256 signing key. **Must be at least 32 bytes**: `JWT_SECRET=supersecret123` makes the server refuse to start. |
| `DALOY_OPT_IN` | No | unset | Set to `1` to switch on the first-party opt-in helpers (`requireRoles`, `fetchGuard`, `assertSafeRelativePath`, `safeRedirect`, `loginThrottle`). |
| `NODE_ENV` | No | treated as `production` unless set to `development` | Production turns the boot guards on and redacts 5xx detail. |
| `DEMO_RESET_TOKEN` | No | unset | Same meaning as on the Express build. |

`DEMO_GATE_TOKEN` and `BODY_LIMIT` are **not** read by this build (it is not
deployed anywhere, and the body limit is the scaffold's 1 MiB).

---

### 1.3 Attacker machine (Node running the attack scripts)

The attack script takes the **URL as a CLI argument**. It does not require API secrets
unless the target has `DEMO_GATE_TOKEN` enabled.

| Variable | Required? | When | Purpose |
| --- | --- | --- | --- |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Sometimes | Zscaler / corporate TLS MITM | Set to `0` if Node fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. **Insecure** — demo laptops only. |
| `DEMO_GATE_TOKEN` | When server is gated | Public gated deploys | Same value as server; alternatively pass `--gate=TOKEN`. |

**Zscaler / corporate TLS-intercept laptop:**

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node --no-warnings attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev
```

```bash
export NODE_TLS_REJECT_UNAUTHORIZED=0
node --no-warnings attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev
```

**Clean network:** leave that variable **unset**.

```powershell
Remove-Item Env:NODE_TLS_REJECT_UNAUTHORIZED -ErrorAction SilentlyContinue
```

---

## 2. Attack script CLI

```text
node --no-warnings attack/attack.mjs   <API_BASE_URL> [flags]   # full, 16 phases
node --no-warnings attack/attackv2.mjs <API_BASE_URL> [flags]   # short, 7 phases
```

Both scripts take the same flags, except that `--skip-slow` exists only on the
full script and `--label=NAME` only on the short one.

| Flag | Meaning |
| --- | --- |
| (none) | Full run: wire logs on, flood on, slow probe on |
| `--drama` | **Wait for Enter** between phases (stage pacing) |
| `--projector` | No dim text; less wire noise (large rooms) |
| `--reset` | `POST /api/demo/reset` before the attack, then verify and repeat (up to 8×) while another warm instance still serves tampered data |
| `--gate=TOKEN` | Send `X-VaultPay-Demo` header (or set `DEMO_GATE_TOKEN` env) |
| `--verbose` | Print response body previews on more requests |
| `--quiet` | Less color; hide per-request wire traces |
| `--json` | Print machine-readable findings after the report |
| `--skip-flood` | Skip 40 parallel login burst |
| `--skip-slow` | Skip `/api/slow?ms=3000` (full script only) |
| `--label=NAME` | Name of the stack shown in the banner (short script only; default is read from `/api/health`) |
| `--internal=URL` | Base URL of the SSRF stand-in internal service (or `INTERNAL_SERVICE_URL`). `npm run demo` sets this for you. |

**Talk / terminal demo:**

```powershell
# Stage: Enter between phases
node --no-warnings attack/attack.mjs https://vaultpay-api.vercel.app --drama --reset
# Fast continuous (no Enter)
node --no-warnings attack/attack.mjs https://vaultpay-api.vercel.app --reset --skip-flood
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
node --no-warnings attack/attack.mjs http://localhost:4000 --drama --reset
node --no-warnings attack/attack.mjs http://127.0.0.1:8787 --drama
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"   # only if TLS intercept
node --no-warnings attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama --reset
node --no-warnings attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama --reset --gate=talk-day-secret
node --no-warnings attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --skip-flood --skip-slow --json
```

Root helpers:

```powershell
npm run attack:local                 # full script → http://localhost:4000 --reset
npm run attack -- https://vaultpay-api.devlinduldulao.workers.dev
npm run attack:short:local           # short script → :4000 --reset --drama --projector
npm run attack:short:daloy           # short script → :4100 (DaloyJS build)
npm run attack:short -- https://vaultpay-api.devlinduldulao.workers.dev --drama --projector --reset
npm run compare                      # all three builds, one table (no server needed)
```

### What the short script prints

Every probe in `attackv2.mjs` ends in one of three observed outcomes:

| On screen | Means |
| --- | --- |
| `✗ APP HOLE` | The attack worked. |
| `◐ REDUCED` | The hole is still open, but the response carried less than the attack wanted (for example, a user list with no SSN or card number). |
| `✓ BLOCKED` | The server refused the probe. |

The script only reports what it sees on the wire. Against the Express build
nothing is reduced or blocked; against the DaloyJS build some probes are.
The full script (`attack.mjs`) prints `✓ OK` for refused probes and does not
keep a blocked / reduced tally.

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
node --no-warnings attack/attack.mjs http://localhost:4000
```

**Expect:** `DEMO RESULT: API PWNED` — 10 critical on localhost with the full script
(including the SSRF self-fetch), 9 critical with the short script.

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
node --no-warnings attack/attack.mjs http://127.0.0.1:8787
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

node --no-warnings attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev
```

Soft run:

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node --no-warnings attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --skip-flood
```

### C5 — Cloudflare vs local Node

| Probe | Local Node | Cloudflare Workers |
| --- | --- | --- |
| Unauth dump / IDOR / debug secret | CRITICAL | CRITICAL |
| Path traversal secret | CRITICAL | CRITICAL |
| BOLA / mass assign / forge admin | CRITICAL | CRITICAL |
| Login flood no 429 | HIGH | HIGH |
| 1.5 MiB body | HIGH | HIGH |
| Open redirect | HIGH | HIGH |
| SSRF self-fetch | CRITICAL | **CF 1042**, then external fetch HIGH |
| HTML echo sink | HIGH | HIGH |
| Raw TCP | HTTP only | **Skipped** (HTTPS) |
| Totals, full script | 10 critical | 9 critical |
| Totals, short script | 9 critical | 8 critical · 57 requests |

The Cloudflare column is the 2026-11-14 capture. Study: [`ATTACK-RUN-CLOUDFLARE.md`](ATTACK-RUN-CLOUDFLARE.md).

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
node --no-warnings attack/attack.mjs https://vaultpay-api.vercel.app
```

### D5 — What differs from Cloudflare

| Probe | Cloudflare | Vercel |
| --- | --- | --- |
| SSRF to own debug URL | **1042** blocked, external fetch still works | **Works** (CRITICAL) |
| `alg:none` token | `401` from the app's JWT library | **403 at the edge** (`x-vercel-mitigated: deny`) |
| HTML echo sink | Works | Works |
| HSTS | Missing | **Present** |
| Totals, full script | 9 critical | 10 critical |
| Totals, short script | 8 critical | 9 critical |
| Authz / PII dump | Still pwned | Still pwned |

Both columns are the 2026-11-14 capture.

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
node --no-warnings attack/attack.mjs https://YOUR-APP.azurewebsites.net
```

---

## 8. Path F — DaloyJS build (laptop only)

The same app, same handler mistakes, on DaloyJS. Rules of the port and the
result table: [`server-daloy/README.md`](server-daloy/README.md).

### F1 — One command

```powershell
npm run compare            # boots Express + two DaloyJS modes, attacks each, prints one table
npm run compare -- --md    # the same table as Markdown
```

### F2 — Or by hand

```powershell
npm run server:daloy               # http://localhost:4100, scaffold defaults
npm run attack:short:daloy         # other terminal

npm run server:daloy:opt-in        # same port, with the opt-in helpers on
npm run server:daloy:weak-secret   # JWT_SECRET=supersecret123 → refuses to start, exit 1
```

**Expect (short script):** scaffold defaults `5 critical · 1 blocked · 5 reduced`;
with opt-ins `4 critical · 5 blocked · 3 reduced`. The forged admin JWT still
works in both, because the debug endpoint still prints the signing key.

### F3 — Things that differ from the Express build

| | Express build | DaloyJS build |
| --- | --- | --- |
| Port | 4000 | 4100 |
| Rate limit | none | 120 requests / minute / client. A third attack run inside a minute gets `429`. |
| Login throttle | none | opt-in mode only: 5 attempts / 15 minutes / client. A second run cannot log in until the server restarts. |
| Deploy targets | Cloudflare, Vercel, Azure | none |
| `/api/health` | `"express":"5"` | `"framework":"DaloyJS (scaffold defaults)"` |

---

## 9. Demo credentials (seed data)

| Email | Password | Role |
| --- | --- | --- |
| `alice@example.com` | `password123` | user |
| `bob@example.com` | `bobsecret` | user |
| `admin@vaultpay.demo` | `admin123` | admin |

Used automatically by the attacker. Default JWT secret: `supersecret123`.

---

## 10. Phase order

### Full script (`attack.mjs`)

Numbers below are with `--reset`. Without it there is no phase 01 and every
later number is one lower.

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
| 15 | Raw TCP (HTTP only) | No |
| 16 | Login, BOLA, admin, mass assign, `alg:none`, forge JWT | Yes (auto) |

The SSRF internal-pivot and redirect-hop probes only run when `--internal=URL`
is set (automatic under `npm run demo`).

### Short script (`attackv2.mjs`)

| # | Phase | Needs login? |
| --- | --- | --- |
| 01 | Demo reset (only with `--reset`) | No |
| 02 | User dump / IDOR / search | No |
| 03 | Path traversal → signing secret | No |
| 04 | Open proxy / SSRF (self-fetch; external fallback) | No |
| 05 | Login, BOLA, admin route, cross-user write, mass assign | Yes (auto) |
| 06 | Login flood | No |
| 07 | `alg:none`, forge admin JWT | No |

With `--drama` there is an Enter pause after every phase, including one after
phase 07 so the forged-admin result stays on screen before the report.
The flood runs after the login on purpose: a login throttle would otherwise lock
the attacker out before the authorization probes.

---

## 11. Talk-day checklist

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
node --no-warnings attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev
node --no-warnings attack/attack.mjs https://vaultpay-api.vercel.app

# 4) Show PLATFORM-COMPARISON.md or CLOUDFLARE-VS-APP-SECURITY.md
# 5) End on: DEMO RESULT: API PWNED
```

For the **10-minute slot** nothing has to be deployed or online: run the Express
build locally (`npm run server`, then `npm run attack:short:local`) and finish
with `npm run compare`. Script: [`TALK.md`](TALK.md#10-minute-before--after).

---

## 12. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Cannot reach http://localhost:…` (short script) | The target is not running. `npm run server` or `npm run server:daloy`. |
| `429` everywhere against the DaloyJS build | Its rate limit is real (120 / minute). Restart that server or wait a minute. |
| `Login answered 429 — this client is locked out` | DaloyJS opt-in mode after an earlier run. Restart the server. |
| `Hijacked Bob` in the user dump on a cloud URL | Another warm instance still has old data. Use `--reset`; both scripts now repeat the reset until the data reads clean. |
| `DaloyJS refused to start … weak_hs_secret` | `JWT_SECRET` is shorter than 32 bytes. Expected for `supersecret123`. |
| `Missing server-daloy/node_modules` from `npm run compare` | `npm run install:all` |
| `fetch failed` / `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` | `$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"` |
| Connection refused | API not running; wrong URL; hit `/api/health` first |
| Wrangler not logged in | `cd server; npx wrangler login` |
| Vercel not logged in | `cd server; vercel login` |
| Few findings | Wrong host / WAF / not this demo |
| SSRF not CRITICAL on Workers | Expected CF `1042` on self-fetch — the proxy still fetches an external URL (HIGH) |
| `◇ PLATFORM alg:none request denied at the edge` on Vercel | Expected. Vercel's firewall answers `403` before the app; the forged-token step is unaffected. |
| Flood flaky | `--skip-flood` |
| Mass-assign 404 on Vercel | Use latest attacker (seed users Alice/Bob); multi-instance RAM |
| `express` not 5 after deploy | Redeploy after `npm install` with `express@^5.3.0` |

---

## 13. Copy-paste env blocks

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
node --no-warnings attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev
node --no-warnings attack/attack.mjs https://vaultpay-api.vercel.app
```

### Clear TLS bypass after the talk

```powershell
Remove-Item Env:NODE_TLS_REJECT_UNAUTHORIZED -ErrorAction SilentlyContinue
```

---

*Educational VaultPay demo only. API + attack script; no frontend. Do not attack third-party systems.*
