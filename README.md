# demo-attack-express — JWT ≠ Secure API

A **live talk demo** that shows why junior developers who finish a YouTube
tutorial on "Express + JWT" and deploy it publicly are still wide open.

There is **no frontend**. The demo is a vulnerable **Express 5 API** plus a
black-box **attack script** that hits the API URL directly.

**Backend stack:** [Express **5.x**](https://www.npmjs.com/package/express) (`express@^5.2.1`) + JWT + in-memory DB.  
Express 5 requires **Node.js >= 18**. Migration notes: [Migrating to Express 5](https://expressjs.com/en/guide/migrating-5/) · [v5 release post](https://expressjs.com/en/blog/2024-10-15-v5-release/) · [`EXPRESS-V5.md`](EXPRESS-V5.md).

| Piece | Folder | Deploy target |
| --- | --- | --- |
| Intentionally vulnerable **Express 5** API | [`server/`](server/) | **Cloudflare Workers** (recommended, free) or **Azure App Service** |
| Black-box attack script | [`attack/attack.mjs`](attack/attack.mjs) | Laptop during the talk |
| Happy + unhappy tests | [`tests/`](tests/) | CI / pre-talk check |
| **Screen slide:** Cloudflare edge vs app security | [`CLOUDFLARE-VS-APP-SECURITY.md`](CLOUDFLARE-VS-APP-SECURITY.md) | Projector after the attack |
| **5-minute talk script** | [`TALK.md`](TALK.md) | Live presentation |

> **Educational only.** Only point the attack script at instances **you** deployed.

---

## Will this work in a real talk?

**Yes, for the core story** — with a few caveats:

| Claim | Reality |
| --- | --- |
| “We added JWT, so the API is secured” | False. Script proves most holes need **no** login. |
| Attack script steals PII without a password | Works locally, on Cloudflare Workers, and Azure. |
| Path traversal / open redirect / open proxy | Built into this Express **5** server; verified by tests. |
| Body-limit + login flood demos | Work on the demo API. Free tiers / WAF *may* throttle floods — use `--skip-flood` if needed. |
| In-memory DB | Resets on restart / Worker cold start. Fine for a talk. |
| Cold start | First request can be slow; hit `/api/health` before the live attack. |
| “But we use Express 5 now” | **v5 does not add authz, rate limits, or secure headers by default.** |

This is **not** a full DDoS tool. The “flood” phase is a short parallel burst that proves **no 429**.

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
| 10 | IDOR `/api/users/:id` | No | Per-route authz (you still write ownership checks) |
| 11 | Debug config leaks JWT secret | No | No debug surface; weak-secret boot guards |
| 12 | Account enumeration via login errors | No | Uniform errors + `timingSafeEqual` patterns |
| 13 | BOLA on `/api/orders` | Yes (any user) | Authz is app logic; contracts/schemas help |
| 14 | Mass assignment `role: "admin"` | Yes | Schema `.strict()` / validated bodies |
| 15 | Admin route without role check | Yes | Explicit security schemes + hooks |
| 16 | Forged JWT after secret leak | After leak | Strong secrets, alg allowlists, no secret echo |
| 17 | Unauth `PUT /api/settings` | No | Auth on mutating routes when declared |

**Honest gap:** Daloy cannot invent *your* ownership rules (`order.userId === req.user.sub`) for you. Defaults still close most junior transport mistakes.

---

## The story you tell the audience

1. Open the live API: `GET /api/health` → `"express":"5"`. Optional: `GET /` shows self-described routes.
2. “Tutorial stack: Express 5 + JWT login. Deployed for public use.”
3. Terminal:

   ```bash
   node attack/attack.mjs https://vaultpay-api.YOUR-SUBDOMAIN.workers.dev --drama
   ```

4. Watch unauth probes first (headers, body, flood, traversal, redirect), then PII theft, then authz collapse and forged admin JWT.
5. Punchline: **Authn ≠ authz**, and **JWT is one control, not a security model**.

---

## Local quick start

```bash
# API
cd server && npm install && npm start

# Tests (other terminal)
cd server && npm test

# Attack (from repo root)
node attack/attack.mjs http://localhost:4000 --drama
# live target:
node attack/attack.mjs https://vaultpay-api.YOUR-SUBDOMAIN.workers.dev --drama
```

| Email | Password | Role |
| --- | --- | --- |
| `alice@example.com` | `password123` | user |
| `bob@example.com` | `bobsecret` | user |
| `admin@vaultpay.demo` | `admin123` | admin |

(The attack script uses these automatically; you do not need to log in first.)

---

## Tests

```bash
cd server
npm test
```

- **`tests/server.test.js`** — happy paths + unhappy 401/400/404 + documented fail-open vulns.
- **`tests/attack-probes.test.js`** — black-box chain matching `attack.mjs`.

---

## Deploy

### Express → Cloudflare Workers (recommended, free)

Full notes: [`server/DEPLOY-CLOUDFLARE.md`](server/DEPLOY-CLOUDFLARE.md).

```bash
cd server
npm install
npx wrangler login          # once
npm run deploy:cf           # → https://vaultpay-api.<you>.workers.dev
```

Local Workers runtime:

```bash
cd server
npm run dev:cf              # → http://127.0.0.1:8787
# other terminal, repo root:
node attack/attack.mjs http://127.0.0.1:8787 --drama
```

### Express → Azure App Service

Deploy the **`server/`** folder (Node 18+).

- Startup: `node server.js` or `npm start`
- `PORT` is provided by Azure
- Optional: `JWT_SECRET=supersecret123`, `BODY_LIMIT=50mb`, `NODE_ENV=production`

---

## Project layout

```text
.
  HOW-TO-ATTACK.md              # step-by-step attack runbook + env vars
  EXPRESS-V5.md                 # Express 5 notes for this demo
  ATTACK-RUN-STUDY.md           # study guide for a real Workers attack log
  CLOUDFLARE-VS-APP-SECURITY.md # screen slide: edge defaults ≠ API security
  TALK.md                       # 5-minute talk script (API only)
  attack/attack.mjs             # theatrical black-box attacker
  server/
    package.json            # express@^5.2.1
    app.js                  # createApp() — Express 5 vulnerable routes
    server.js               # Node / Azure listen()
    worker.mjs              # Cloudflare Workers entry
    wrangler.toml           # CF deploy config
    DEPLOY-CLOUDFLARE.md    # CF deploy runbook
    vfs.js                  # virtual FS (path traversal)
    db.js                   # in-memory seed + reset()
    merge.js                # unsafe deep merge
    data/                   # sample public + secrets (also in vfs)
  tests/
    server.test.js
    attack-probes.test.js
  README.md
```

---

## How to attack (step by step)

**[`HOW-TO-ATTACK.md`](HOW-TO-ATTACK.md)** — full env vars, local / Cloudflare / Azure paths, Zscaler TLS notes, talk-day checklist.

Quick live attack:

```powershell
# From repo root. Zscaler only if Node cert errors:
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama
```

## Attack script console output

Wire logging is **on by default**:

```text
  → SEND  #12  GET /api/users
  ← RECV  #12  200  18ms
  ✗ VULNERABLE     Returned 4 full accounts without auth
   LOOT  #1 alice@example.com  ...
  [CRITICAL] Unauthenticated user dump
```

| Flag | Use |
| --- | --- |
| (default) | Phases, wire logs, LOOT, scoreboard |
| `--verbose` | Response body previews |
| `--drama` | Pause between phases (talks) |
| `--quiet` | Less color / wire noise |
| `--skip-flood` | Skip 40-way login burst |
| `--skip-slow` | Skip `/api/slow` |
| `--json` | Machine-readable findings at end |

---

## Ethics

Sample PII/cards/SSNs are fake. **Do not** aim `attack.mjs` at third-party systems.
