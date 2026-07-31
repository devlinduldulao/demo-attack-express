# demo-attack-express — JWT ≠ Secure API

A **live talk demo** that shows why junior developers who finish a YouTube
tutorial on "Express + JWT + React" and deploy it publicly are still wide open.

**Backend stack:** [Express **5.x**](https://www.npmjs.com/package/express) (`express@^5.2.1`) + JWT + in-memory DB.  
Express 5 requires **Node.js >= 18**. Migration notes: [Migrating to Express 5](https://expressjs.com/en/guide/migrating-5/) · [v5 release post](https://expressjs.com/en/blog/2024-10-15-v5-release/) · demo notes in [`EXPRESS-V5.md`](EXPRESS-V5.md).

| Piece | Folder | Deploy target |
| --- | --- | --- |
| Intentionally vulnerable **Express 5** API | [`server/`](server/) | **Cloudflare Workers** (recommended, free) or **Azure App Service** |
| Pretty React SPA login + dashboard | [`client/`](client/) | **GitHub Pages** (static) |
| Black-box attack script | [`attack/attack.mjs`](attack/attack.mjs) | Laptop during the talk |
| Happy + unhappy tests | [`tests/`](tests/) | CI / pre-talk check |

> **Educational only.** Only point the attack script at instances **you** deployed.

---

## Will this work in a real talk?

**Yes, for the core story** — with a few caveats:

| Claim | Reality |
| --- | --- |
| SPA login + JWT “feels secure” | Works. Dashboard loads with Bearer token. |
| Attack script steals PII without a password | Works locally, on Cloudflare Workers, and Azure. |
| Path traversal / open redirect / open proxy | Built into this Express **5** server; verified by tests. |
| Body-limit + login flood demos | Work on the demo API. Azure Free tier / front-door WAF *may* add platform limits — use `--skip-flood` if the free plan throttles you. |
| In-memory DB | Resets on App Service restart/scale-out / Worker cold start. Fine for a talk; not a real bank. |
| Cold start | First request can be slow; hit `/api/health` before the live attack. |
| “But we use Express 5 now” | **v5 does not add authz, rate limits, or secure headers by default.** Same junior mistakes still apply. |

This is **not** a full DDoS tool. The “flood” phase is a short parallel burst (dozens of logins) that proves **no 429**, not a network-layer denial of service.

---

## Map: attack → DaloyJS default that would have blocked it

| # | Attack (this demo) | Needs login? | DaloyJS built-in / default |
| --- | --- | --- | --- |
| 1 | Missing `X-Frame-Options` / CSP / nosniff | No | `secureHeaders` auto-install |
| 2 | ~1.5 MiB JSON accepted (no 413) | No | `bodyLimitBytes` default **1 MiB** + `readBodyLimited` |
| 3 | 40× parallel login → zero `429` | No | `rateLimit` / `loginThrottle` |
| 4 | Path traversal `/api/files?name=../secrets/...` | No | Routing path hardening / contained static serving |
| 5 | Open redirect `/api/go?url=https://evil…` | No | `safeRedirect` |
| 6 | Open proxy `/api/proxy?url=` (loopback SSRF) | No | `fetchGuard` (blocks loopback / link-local / metadata) |
| 7 | Stack traces + HTML reflection (XSS sink) | No | Prod problem+json redaction; no raw HTML echo |
| 8 | Slow handler holds socket (no timeout) | No | `requestTimeoutMs` default **30s** |
| 9 | `GET /api/users` full PII dump | No | Fail-closed auth hooks + response schemas |
| 10 | IDOR `/api/users/:id` | No | Per-route authz (you still write ownership checks; framework won’t invent them — but defaults stop “no auth at all” patterns when routes declare security) |
| 11 | Debug config leaks JWT secret | No | No debug surface; weak-secret boot guards |
| 12 | Account enumeration via login errors | No | Uniform errors + `timingSafeEqual` patterns |
| 13 | BOLA on `/api/orders` | Yes (any user) | Authz is app logic; Daloy pushes contract/schemas so over-broad responses are harder to ship silently |
| 14 | Mass assignment `role: "admin"` | Yes | Schema `.strict()` / validated bodies |
| 15 | Admin route without role check | Yes | Explicit security schemes + hooks |
| 16 | Forged JWT after secret leak | After leak | Strong secrets, alg allowlists, no secret echo |
| 17 | Unauth `PUT /api/settings` | No | Auth required by default on mutating routes when you declare them |

**Honest gap:** Daloy cannot invent *your* ownership rules (`order.userId === req.user.sub`) for you. The demo’s BOLA still requires an authorization check in handler code. What Daloy *does* change is everything juniors skip: body caps, timeouts, headers, rate limits, safe redirects, SSRF, parser pollution, weak JWT algorithms, and fail-closed defaults so “I added JWT on `/me`” is not the whole security model.

---

## The story you tell the audience

1. Show the SPA. Login as Alice. Point at **"JWT secured"**.
2. DevTools → Bearer token on `/api/me`. “We’re protected.”
3. Terminal:

   ```bash
   node attack/attack.mjs https://YOUR-APP.azurewebsites.net
   ```

4. Watch unauth transport probes first (headers, body, flood, traversal, redirect, SSRF), then data theft, then authz collapse and forged admin JWT.
5. Punchline: **Authn ≠ authz**, and **JWT is one control, not a framework**.

---

## Local quick start

```bash
# API
cd server && npm install && npm start

# SPA (other terminal)
cd client && npm install && npm run dev

# Tests (other terminal)
cd server && npm test

# Attack (from repo root)
node attack/attack.mjs http://localhost:4000
# gentler on free Azure / Cloudflare:
node attack/attack.mjs https://YOUR-APP.azurewebsites.net --skip-flood --skip-slow
```

| Email | Password | Role |
| --- | --- | --- |
| `alice@example.com` | `password123` | user |
| `bob@example.com` | `bobsecret` | user |
| `admin@vaultpay.demo` | `admin123` | admin |

---

## Tests

```bash
cd server
npm test
```

- **`tests/server.test.js`** — happy paths (login, me, register, orders, public file) + unhappy paths that *do* 401/400/404 + **documented fail-open vulns** the demo depends on.
- **`tests/attack-probes.test.js`** — black-box probe chain matching `attack.mjs` (traversal, redirect, SSRF, flood, BOLA, forge).

If a “vulnerability” test fails, the talk script will lie. Fix the server or the test before going on stage.

---

## Deploy

### Express → Cloudflare Workers (recommended, free)

Uses the official Express-on-Workers pattern
([Cloudflare tutorial](https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/)):
`nodejs_compat` + `httpServerHandler` from `cloudflare:node`.

Full notes: [`server/DEPLOY-CLOUDFLARE.md`](server/DEPLOY-CLOUDFLARE.md).

```bash
cd server
npm install
npx wrangler login          # once
npm run deploy:cf           # → https://vaultpay-api.<you>.workers.dev
```

Local Workers runtime (same code path as prod):

```bash
npm run dev:cf              # → http://127.0.0.1:8787
node ../attack/attack.mjs http://127.0.0.1:8787 --drama
```

| File | Role |
| --- | --- |
| `server/wrangler.toml` | Worker name, `nodejs_compat`, demo vars |
| `server/worker.mjs` | CF entrypoint (`app.listen` + `httpServerHandler`) |
| `server/app.js` | Shared Express app (Node / Azure / Workers) |
| `server/vfs.js` | In-memory files so path traversal works without disk |

**SPA:** set `VITE_API_URL` to your `*.workers.dev` URL when building the client.

### Express → Azure App Service (still supported)

Deploy the **`server/`** folder (Node 18+, Linux Free F1 is enough).

- Startup: `node server.js` (or `npm start`)
- `PORT` is provided by Azure
- Optional app settings: `JWT_SECRET=supersecret123` (keep weak for the demo)

### React → GitHub Pages

```powershell
cd client
$env:VITE_API_URL="https://YOUR-APP.azurewebsites.net"
# project pages only:
# $env:VITE_BASE="/your-repo-name/"
npm run build
# publish client/dist/
```

CORS is `*` on purpose so Pages → Azure works without extra config.

---

## Project layout

```text
.
  HOW-TO-ATTACK.md          # step-by-step attack runbook + env vars
  EXPRESS-V5.md             # Express 4 → 5 notes for this demo
  ATTACK-RUN-STUDY.md       # study guide for a real Workers attack log
  attack/attack.mjs         # theatrical black-box attacker
  server/
    package.json            # express@^5.2.1
    app.js                  # createApp() — Express 5 vulnerable routes
    server.js               # Node / Azure listen() (v5 error callback)
    worker.mjs              # Cloudflare Workers entry
    wrangler.toml           # CF deploy config
    DEPLOY-CLOUDFLARE.md    # CF deploy runbook
    vfs.js                  # virtual FS (path traversal on Workers)
    db.js                   # in-memory seed + reset()
    merge.js                # unsafe deep merge
    data/public/            # sample public text (also in vfs)
    data/secrets/           # sample secrets text (also in vfs)
  client/                   # Vite + React SPA
  tests/
    server.test.js
    attack-probes.test.js
  README.md
```

---

## How to attack (step by step)

Full runbook with every environment variable, local / Cloudflare / Azure paths, Zscaler TLS notes, and talk-day checklist:

**[`HOW-TO-ATTACK.md`](HOW-TO-ATTACK.md)**

Quick live attack (after deploy):

```powershell
# From repo root. Corporate TLS intercept (Zscaler) only if Node cert errors:
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama
```

## Attack script console output

Wire logging is **on by default** so a talk audience can follow every move:

```text
  → SEND  #12  GET /api/users
           auth=none  body=—  timeout=15000ms
  ← RECV  #12  200  18ms  1842 B
  ✗ VULNERABLE     Returned 4 full accounts without auth
   LOOT  #1 alice@example.com  role=user ssn=123-45-6789 card=…
  [CRITICAL] Unauthenticated user dump
  ── scoreboard: 3 critical · 2 high · …
```

| Flag | Use |
| --- | --- |
| (default) | Colored phases, `→ SEND` / `← RECV`, LOOT tags, live scoreboard |
| `--verbose` | Print response body previews on every request |
| `--drama` | Pause between phases so the room can read the screen |
| `--quiet` | Less color, hide wire traces (summary only) |
| `--skip-flood` | Skip 40-way login burst (safer on free Azure) |
| `--skip-slow` | Skip `/api/slow` timing probe |
| `--json` | Machine-readable findings after the report |

```bash
# Best for a projected terminal during a talk:
node attack/attack.mjs https://YOUR-APP.azurewebsites.net --drama

# Full body dumps while rehearsing:
node attack/attack.mjs http://localhost:4000 --verbose
```

---

## Ethics

Sample PII/cards/SSNs are fake. **Do not** aim `attack.mjs` at third-party systems. Unauthorized access is a crime; this folder is for systems you control and for teaching.
