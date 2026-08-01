# Deploy VaultPay Express 5 to Vercel

Same intentional vulnerable **Express 5** API as Cloudflare / Node.  
Deploy is **from your local machine** with the Vercel CLI (like `wrangler deploy`).  
A **private GitHub repo is not required** unless you choose Git integration later.

| Item | Value |
| --- | --- |
| Project | `vaultpay-api` (created under your Vercel team) |
| Production alias | `https://vaultpay-api.vercel.app` |
| Entry | [`api/index.js`](api/index.js) → exports Express app |
| Config | [`vercel.json`](vercel.json) |

---

## Prerequisites

1. Node.js >= 24 (see `package.json` `engines`)
2. Vercel CLI logged in (`vercel whoami`)  
3. From this folder (`server/`):

```powershell
cd server
npm install
```

**Corporate TLS (Zscaler):** Node may need:

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
```

---

## One-command production deploy

```powershell
cd server
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"   # if cert errors
vercel --prod --yes
```

Or from repo root:

```powershell
npm run deploy:vercel
```

First run creates the Vercel project and prints a production URL, then aliases (e.g. `https://vaultpay-api.vercel.app`).

---

## Confirm

```powershell
Invoke-RestMethod https://vaultpay-api.vercel.app/api/health
# expect: ok=true, express=5

Invoke-RestMethod https://vaultpay-api.vercel.app/api/debug/config
# expect: runtime=vercel-serverless (and jwtSecret — intentional demo leak)
```

---

## Attack

From **repository root**:

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"   # if needed
node attack/attack.mjs https://vaultpay-api.vercel.app --drama --reset
# if DEMO_GATE_TOKEN is set on the project:
node attack/attack.mjs https://vaultpay-api.vercel.app --drama --reset --gate=YOUR_TOKEN
```

`--drama` waits for **Enter** between phases. After the talk: remove the project or leave the gate on — [`../TEARDOWN.md`](../TEARDOWN.md).

---

## Optional env on Vercel dashboard / CLI

Defaults are hard-coded weak demo values in the app. To set explicitly:

```powershell
cd server
vercel env add JWT_SECRET production
# paste: supersecret123
vercel env add BODY_LIMIT production
# paste: 50mb
# recommended for public demos (blocks scanners without the header):
vercel env add DEMO_GATE_TOKEN production
# paste: talk-day-secret
vercel --prod --yes
```

| Variable | Default in code | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | `supersecret123` | Weak JWT secret (**app-code** risk surface) |
| `BODY_LIMIT` | `50mb` | Huge JSON limit — **intentional misconfig** (Express `json()` default is **100kb**) |
| `VERCEL` | set by platform | Runtime label |

## Intentional misconfig shipped to Vercel (not Vercel’s fault)

Same three **`misconfig`** findings as Cloudflare (shared `app.js`). Hosting on Vercel does **not** create them:

| Knob | What we ship | Safer Express story | Attack tag |
| --- | --- | --- | --- |
| CORS | `cors({ origin: "*" })` in `app.js` | Bare Express has **no** CORS | `(misconfig)` HIGH |
| Body size | `BODY_LIMIT` default/`env` + custom `jsonBody` | `express.json()` **100kb** → **413** | `(misconfig)` HIGH |
| Stack leak | `/api/boom` + error middleware return `stack` | Prod `finalhandler` redacts stacks | `(misconfig)` MEDIUM |

Edge may still add **HSTS**; the attack script treats missing app Helmet headers as **framework-gap**, not “Vercel failed.”  
Full matrix: [`../CLOUDFLARE-VS-APP-SECURITY.md`](../CLOUDFLARE-VS-APP-SECURITY.md#whose-fault-cloud-deploy-honesty).

---

## How it works

1. [`api/index.js`](api/index.js) calls `createApp()` and **default-exports** the Express app.  
2. [`vercel.json`](vercel.json) rewrites `/(.*)` → `/api` so every path hits that function.  
3. `maxDuration: 30` allows the `/api/slow?ms=3000` demo (Hobby plan limits apply).  
4. In-memory DB is **per isolate** — cold starts re-seed; concurrent instances do not share memory.

---

## Notes vs Cloudflare Workers

| Topic | Vercel | Cloudflare (this demo) |
| --- | --- | --- |
| Deploy | `vercel --prod` from `server/` | `wrangler deploy` from `server/` |
| GitHub private | Not required for CLI deploy | Not required for CLI deploy |
| SSRF to own URL | Often **works** | Often **1042** blocked |
| HSTS | Often **set by edge** | Often missing on workers.dev |
| Function timeout | Plan-dependent (e.g. 10–60s) | Worker limits differ |
| State | Multi-instance RAM | Multi-isolate RAM |

Same app source: [`app.js`](app.js).

---

## Local Vercel emulator (optional)

```powershell
cd server
vercel dev
```

Then attack `http://localhost:3000` (port may vary).

---

## Project files

| File | Role |
| --- | --- |
| `api/index.js` | Serverless entry exporting Express |
| `vercel.json` | Rewrites + function limits |
| `.vercelignore` | Skip noise from upload |
| `app.js` | Shared vulnerable routes |
| `server.js` | Long-running Node / Azure |
| `worker.mjs` | Cloudflare Workers entry |

---

*Educational only.*
