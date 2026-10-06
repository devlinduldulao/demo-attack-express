# demo-attack-express — JWT ≠ Secure API

A **live talk demo** that shows why “Express + JWT + cloud deploy” is not a
security model. There is **no frontend**. The demo is a vulnerable **Express 5
API** plus a black-box **attack script** that hits the API URL directly.

**Claim (defend end-to-end):**

> JWT is not the only thing you need. Your framework gives you almost nothing —
> and nothing is not a security model.

Express’s defaults are fine **where they exist**. The problem is **how few of
them exist** — and real apps still ship path traversal, open proxies, and
`requireAuth` without role checks. This repo labels findings honestly so a
skeptic in row 3 cannot sink the talk.

**Backend stack:** [Express **5.x**](https://www.npmjs.com/package/express)
(`express@^5.2.1`) + JWT + in-memory DB. This package pins **Node.js >= 24**
(`server/package.json`); Express 5 itself needs Node >= 18. Migration notes:
[Migrating to Express 5](https://expressjs.com/en/guide/migrating-5/) ·
[v5 release post](https://expressjs.com/en/blog/2024-10-15-v5-release/) ·
[`EXPRESS-V5.md`](EXPRESS-V5.md).

| Piece | Folder | Deploy target |
| --- | --- | --- |
| Intentionally vulnerable **Express 5** API | [`server/`](server/) | **Cloudflare Workers**, **Vercel**, or **Azure** |
| Black-box attack script | [`attack/attack.mjs`](attack/attack.mjs) | Laptop during the talk |
| One-command local demo | [`scripts/`](scripts/) | Laptop (`npm run demo`) |
| **Talk scripts** (5 min + **30–45 min**) | [`TALK.md`](TALK.md) | Live presentation |
| Edge vs app framing | [`CLOUDFLARE-VS-APP-SECURITY.md`](CLOUDFLARE-VS-APP-SECURITY.md) | After the attack |
| Platform comparison CF vs Vercel | [`PLATFORM-COMPARISON.md`](PLATFORM-COMPARISON.md) | Differentiator block |
| Post-talk teardown / gate | [`TEARDOWN.md`](TEARDOWN.md) | **Do this** after the talk |

**Live demos (Express 5, same app source, intentionally vulnerable):**

| Platform | URL | Latest engagement (2026-08-01) | Study |
| --- | --- | --- | --- |
| Cloudflare Workers | https://vaultpay-api.devlinduldulao.workers.dev | **9** critical · 71 req · 4.3s · forge **YES** | [`ATTACK-RUN-CLOUDFLARE.md`](ATTACK-RUN-CLOUDFLARE.md) |
| Vercel serverless | https://vaultpay-api.vercel.app | **10** critical · 70 req · 10.1s · forge **YES** | [`ATTACK-RUN-VERCEL.md`](ATTACK-RUN-VERCEL.md) |

(+1 critical on Vercel = self-SSRF of debug secret; CF blocks self-fetch with 1042.) Comparison: [`PLATFORM-COMPARISON.md`](PLATFORM-COMPARISON.md).

> **Educational only.** Only point the attack script at instances **you** deployed.
> Public open-proxy / XSS sinks are abuse risk — gate or tear down ([`TEARDOWN.md`](TEARDOWN.md)).

---

## Will this work in a real talk?

**Yes — for the JWT claim especially.** Qualified yes for the “frameworks give
you almost nothing” framing if you use the honest labels.

| Claim | Reality |
| --- | --- |
| “We added JWT, so the API is secured” | False. Script proves most holes need **no** login. |
| Unauth PII, IDOR, BOLA, mass-assign, BFLA, forged JWT | Real chain; nobody argues with it. |
| Path traversal / open redirect / open proxy | **App code** in this server — not Express inventing them. |
| “Express accepts 1.5 MiB bodies by default” | **False.** `express.json()` is **100 kb**. Demo uses a custom ~50 mb parser (**misconfig**). |
| “Express leaks stacks in production” | **False** by default — `finalhandler` redacts when `NODE_ENV=production`. Demo overrides (**misconfig**). |
| “Express CORS is `*` by default” | **False.** Bare Express has **no** CORS. Demo added `cors` + `origin: "*"` (**misconfig**). |
| Real Express gaps | No secure headers, `x-powered-by` ON, no rate limit, no request timeout, no authz primitive, no response schema. |
| Edge WAF / CF 1042 | May block *some* probes (`◇ PLATFORM`); does **not** fix API authz. |
| In-memory DB | Resets on restart / cold start. Fine for a talk. |
| Misconfig on CF/Vercel | CORS `*`, `BODY_LIMIT=50mb`, stack leak are **this app/env** — same on both clouds. Not platform defaults. See [`CLOUDFLARE-VS-APP-SECURITY.md`](CLOUDFLARE-VS-APP-SECURITY.md#whose-fault-cloud-deploy-honesty). |

---

## Finding kinds (on-screen honesty)

Every recorded finding carries a `kind`. The engagement report also prints a **Whose fault?** block so cloud runs do not get blamed on Express or the host for the three misconfigs.

| kind | Meaning | Cloud deploy note |
| --- | --- | --- |
| `framework-gap` | Express does not provide this control by default | Same on CF and Vercel |
| `misconfig` | Demo app/env weakened a safer Express default (CORS, body, stack) | Shipped in `app.js` / `BODY_LIMIT` — **not** CF/Vercel inventing them |
| `app-code` | Vulnerable route / app logic (not a framework default) | Same hole on every host |
| `◇ PLATFORM` | Edge/runtime blocked a **probe** | Only class that differs by cloud (e.g. CF 1042) |

OWASP API Top 10 tags (`API1` BOLA, `API2` broken auth, `API3` BOPLA, `API4`
unrestricted resource, `API5` BFLA, `API7` SSRF, `API8` misconfig/security)
appear on findings so the security-literate part of the room maps the chain.

---

## Map: attack → what failed (no product pitch)

| # | Attack | Needs login? | What failed |
| --- | --- | --- | --- |
| 1 | Missing CSP / XFO / nosniff; `X-Powered-By` | No | **framework-gap** |
| 2 | CORS `origin: "*"` | No | **misconfig** (bare Express has no CORS) |
| 3 | ~1.5 MiB JSON accepted | No | **misconfig** (custom 50 mb parser; Express default 100 kb) |
| 4 | 40× parallel login → zero `429` | No | **framework-gap** |
| 5 | Path traversal `/api/files?name=../secrets/…` | No | **app-code** |
| 6 | Open redirect `/api/go?url=` | No | **app-code** |
| 7 | Open proxy `/api/proxy?url=` (self / external) | No | **app-code** (no SSRF primitive in Express) |
| 8 | SSRF-class URL `169.254.169.254` (no egress policy) | No | **app-code** — often empty on CF/Vercel (`◇ PLATFORM`) |
| 9 | Stack leak + HTML echo | No | **misconfig** + **app-code** |
| 10 | Slow handler holds socket | No | **framework-gap** |
| 11 | `GET /api/users` full PII dump | No | **app-code** / missing authz |
| 12 | IDOR `/api/users/:id` | No | **app-code** |
| 13 | Debug config leaks JWT secret | No | **app-code** |
| 14 | Account enumeration via login errors | No | **app-code** |
| 15 | Unauth `PUT /api/settings` | No | **app-code** |
| 16 | BOLA on `/api/orders` | Yes (any user) | **app-code** — authn ≠ authz |
| 17 | Mass assignment `role: "admin"` | Yes | **app-code** |
| 18 | Cross-user write | Yes | **app-code** |
| 19 | Admin route without role check | Yes | **app-code** + no authz primitive |
| 20 | Forged JWT after secret leak | After leak | Weak secret + leak surface |
| — | `alg:none` unsigned JWT | — | **Rejected.** jsonwebtoken v9 pins HS256/384/512 for string secrets |
| * | SSRF internal pivot + redirect hop | No | **Local only** — `npm run demo` / `--internal=URL` (not on public CF/Vercel) |

**Honest gap for any framework:** ownership rules
(`order.userId === req.user.sub`) are still **your** code. Defaults only close
transport and foot-gun classes.

Optional after-talk note: secure-by-default frameworks (e.g. body limits, rate
limits, headers, schemas, fail-closed auth hooks) shrink the app-code blast radius.
They are a **30-second close**, not a running commentary during the attack.

### Terms you’ll see on screen

| Term | Meaning |
| --- | --- |
| **IDOR** | *Insecure Direct Object Reference* — client picks an object id (`/api/users/2`) and the server returns it without checking ownership. |
| **BOLA** | *Broken Object Level Authorization* (OWASP API1) — same idea for APIs: authn OK, object-level authz missing (e.g. Alice’s JWT lists everyone’s orders). |
| **BFLA** | *Broken Function Level Authorization* (API5) — role/function checks missing (any user hits admin routes). |
| **Mass assignment** | Client writes privileged fields (`role: "admin"`) and the app saves them (API3). |
| `app-code` | Hole is in **your route logic**, not Express defaults. |
| `misconfig` | Demo weakened a safer Express default (body size, stack, CORS). |
| `framework-gap` | Express does not ship this control (rate limit, secure headers, …). |

---

## The story you tell the audience

1. Open the live API: `GET /api/health` → `"express":"5"`.
2. “Tutorial stack: Express 5 + JWT login. Deployed for public use.”
3. Terminal (stage: Enter between phases):

   ```bash
   node --no-warnings attack/attack.mjs https://vaultpay-api.YOUR-SUBDOMAIN.workers.dev --drama --reset
   # if DEMO_GATE_TOKEN is set on the server:
   node --no-warnings attack/attack.mjs https://… --drama --reset --gate=talk-day-secret
   ```

4. Watch unauth probes first, then PII theft, then authz collapse and forged admin JWT.
5. Punchline: **Authn ≠ authz**, **edge ≠ API security**, **nothing is not a security model**.
6. Expand **CF vs Vercel** for 30–45 min slots ([`TALK.md`](TALK.md)).

Full scripts: **[`TALK.md`](TALK.md)**.

---

## Local quick start

```bash
# One command (boots vulnerable server, runs attack, exits)
npm install --prefix server
npm run demo

# Or two terminals
cd server && npm start
# other terminal, repo root:
node --no-warnings attack/attack.mjs http://localhost:4000 --reset --projector
```

| Email | Password | Role |
| --- | --- | --- |
| `alice@example.com` | `password123` | user |
| `bob@example.com` | `bobsecret` | user |
| `admin@vaultpay.demo` | `admin123` | admin |

(The attack script uses these automatically.)

---

## Deploy

### Express → Cloudflare Workers

Full notes: [`server/DEPLOY-CLOUDFLARE.md`](server/DEPLOY-CLOUDFLARE.md).

```bash
cd server
npm install
npx wrangler login          # once
npm run deploy:cf           # → https://vaultpay-api.<you>.workers.dev
# optional gate:
npx wrangler secret put DEMO_GATE_TOKEN
```

### Express → Vercel

Full notes: [`server/DEPLOY-VERCEL.md`](server/DEPLOY-VERCEL.md).

```bash
cd server
npm install
vercel login
vercel --prod --yes
# optional: vercel env add DEMO_GATE_TOKEN production
```

### Express → Azure App Service

Deploy the **`server/`** folder (Node **>= 24** per `package.json`). Startup: `node server.js`.
Optional: `JWT_SECRET`, `BODY_LIMIT=50mb`, `NODE_ENV=production`, `DEMO_GATE_TOKEN`.

---

## Project layout

```text
.
  HOW-TO-ATTACK.md                # step-by-step attack + env vars
  TEARDOWN.md                     # gate or delete public deploys
  EXPRESS-V5.md                   # Express 5 notes (incl. body-limit honesty)
  ATTACK-RUN-CLOUDFLARE.md
  ATTACK-RUN-VERCEL.md
  PLATFORM-COMPARISON.md          # CF vs Vercel — expand in long talks
  CLOUDFLARE-VS-APP-SECURITY.md
  TALK.md                         # 5 min + 30–45 min scripts
  attack/attack.mjs               # black-box attacker (terminal only)
  scripts/
    demo.mjs                      # one command: API + internal service + attack
    internal-service.mjs          # SSRF stand-in (local --internal only)
  server/
  README.md
```

---

## How to attack (step by step)

**[`HOW-TO-ATTACK.md`](HOW-TO-ATTACK.md)** — full env vars, local / Cloudflare /
Vercel / Azure paths, Zscaler TLS notes, talk-day checklist.

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"   # Zscaler only
node --no-warnings attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev
node --no-warnings attack/attack.mjs https://vaultpay-api.vercel.app
```

## Attack script console output

Wire logging is **on by default**. Findings show severity, OWASP id, and kind.

```text
  → SEND  #12  GET /api/users
  ← RECV  #12  200  18ms
  ✗ APP HOLE       Returned 4 full accounts without auth
   LOOT  #1 alice@example.com  ...
  [CRITICAL] [API1] (app-code) Unauthenticated user dump
```

| Flag | Use |
| --- | --- |
| (default) | Phases run straight through, wire logs, LOOT, scoreboard |
| `--drama` | **Wait for Enter** between phases (talk control — same attack) |
| `--verbose` | Response body previews |
| `--projector` | No dim text, less wire noise (big rooms) |
| `--reset` | `POST /api/demo/reset` first (warm-isolate hygiene) |
| `--gate=TOKEN` | Send `X-VaultPay-Demo` (or set `DEMO_GATE_TOKEN` env) |
| `--quiet` | Less color / wire noise |
| `--skip-flood` | Skip 40-way login burst |
| `--skip-slow` | Skip `/api/slow` |
| `--json` | Machine-readable findings at end |

End of run prints **ENGAGEMENT REPORT → DEMO RESULT → REMEDIATION** (one quick-fix map by kind). Fixes are **not** printed mid-phase so LOOT stays stage-clean.

---

## Ethics & license

Sample PII/cards/SSNs are fake. **Do not** aim `attack.mjs` at third-party systems.
**Tear down or gate** public deploys after the talk — see [`TEARDOWN.md`](TEARDOWN.md).

MIT + educational-use notice: [`LICENSE`](LICENSE).
