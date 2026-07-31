# demo-attack-express — JWT ≠ Secure API

[![test](https://github.com/devlinduldulao/demo-attack-express/actions/workflows/test.yml/badge.svg)](https://github.com/devlinduldulao/demo-attack-express/actions/workflows/test.yml)

A **live talk demo** that shows why “Express + JWT + cloud deploy” is not a
security model. There is **no frontend**. The demo is a vulnerable **Express 5
API** plus a black-box **attack script** that hits the API URL directly.

**Thesis (defend end-to-end):**

> JWT is not the only thing you need. Your framework gives you almost nothing —
> and nothing is not a security model.

Express’s defaults are fine **where they exist**. The problem is **how few of
them exist** — and juniors still write path traversal, open proxies, and
`requireAuth` without role checks. This repo labels findings honestly so a
skeptic in row 3 cannot sink the talk.

**Green run:** same attack script against `HARDENED=1` → **0 critical**. Fix it
in plain Express first; frameworks that default closed are the optional close.

**Backend stack:** [Express **5.x**](https://www.npmjs.com/package/express)
(`express@^5.2.1`) + JWT + in-memory DB. Express 5 requires **Node.js >= 18**.
Migration notes: [Migrating to Express 5](https://expressjs.com/en/guide/migrating-5/) ·
[v5 release post](https://expressjs.com/en/blog/2024-10-15-v5-release/) ·
[`EXPRESS-V5.md`](EXPRESS-V5.md).

| Piece | Folder | Deploy target |
| --- | --- | --- |
| Intentionally vulnerable **Express 5** API | [`server/`](server/) | **Cloudflare Workers**, **Vercel**, or **Azure** |
| Black-box attack script | [`attack/attack.mjs`](attack/attack.mjs) | Laptop during the talk |
| Happy + unhappy tests | [`tests/`](tests/) | CI / pre-talk check |
| **Talk scripts** (5 min + **30–45 min**) | [`TALK.md`](TALK.md) | Live presentation |
| Edge vs app framing | [`CLOUDFLARE-VS-APP-SECURITY.md`](CLOUDFLARE-VS-APP-SECURITY.md) | After the attack |
| Platform comparison CF vs Vercel | [`PLATFORM-COMPARISON.md`](PLATFORM-COMPARISON.md) | Differentiator block |
| Post-talk teardown / gate | [`TEARDOWN.md`](TEARDOWN.md) | **Do this** after the talk |

**Live demos (Express 5, same app source):**

| Platform | URL | Attack study |
| --- | --- | --- |
| Cloudflare Workers | https://vaultpay-api.devlinduldulao.workers.dev | [`ATTACK-RUN-CLOUDFLARE.md`](ATTACK-RUN-CLOUDFLARE.md) |
| Vercel serverless | https://vaultpay-api.vercel.app | [`ATTACK-RUN-VERCEL.md`](ATTACK-RUN-VERCEL.md) |

Both deploys were **local CLI → cloud** (no GitHub integration required).

> **Educational only.** Only point the attack script at instances **you** deployed.
> Public open-proxy / XSS sinks are abuse risk — gate or tear down ([`TEARDOWN.md`](TEARDOWN.md)).

---

## Will this work in a real talk?

**Yes — for the JWT thesis especially.** Qualified yes for the “frameworks give
you almost nothing” framing if you use the honest labels.

| Claim | Reality |
| --- | --- |
| “We added JWT, so the API is secured” | False. Script proves most holes need **no** login. |
| Unauth PII, IDOR, BOLA, mass-assign, BFLA, forged JWT | Real chain; nobody argues with it. |
| Path traversal / open redirect / open proxy | **Junior code** in this server — not Express inventing them. |
| “Express accepts 1.5 MiB bodies by default” | **False.** `express.json()` is **100 kb**. Demo uses a custom ~50 mb parser (**misconfig**). |
| “Express leaks stacks in production” | **False** by default — `finalhandler` redacts when `NODE_ENV=production`. Demo overrides (**misconfig**). |
| “Express CORS is `*` by default” | **False.** Bare Express has **no** CORS. Demo added `cors` + `origin: "*"` (**misconfig**). |
| Real Express gaps | No secure headers, `x-powered-by` ON, no rate limit, no request timeout, no authz primitive, no response schema. |
| Edge WAF / CF 1042 | May block *some* probes (`◇ PLATFORM`); does **not** fix API authz. |
| In-memory DB | Resets on restart / cold start. Fine for a talk. |

---

## Finding kinds (on-screen honesty)

Every recorded finding carries a `kind`:

| kind | Meaning |
| --- | --- |
| `framework-gap` | Express does not provide this control by default |
| `misconfig` | Junior weakened / replaced a safer Express default |
| `junior-code` | Intentionally vulnerable app code (not a framework default) |

OWASP API Top 10 tags (`API1` BOLA, `API2` broken auth, `API3` BOPLA, `API4`
unrestricted resource, `API5` BFLA, `API7` SSRF, `API8` misconfig/security)
appear on findings so the security-literate part of the room maps the chain.

---

## Map: attack → what failed (no product pitch)

| # | Attack | Needs login? | What failed |
| --- | --- | --- | --- |
| 1 | Missing CSP / XFO / nosniff; `X-Powered-By` | No | **framework-gap** |
| 2 | ~1.5 MiB JSON accepted | No | **misconfig** (custom 50 mb parser; Express default 100 kb) |
| 3 | 40× parallel login → zero `429` | No | **framework-gap** |
| 4 | Path traversal `/api/files?name=../secrets/…` | No | **junior-code** |
| 5 | Open redirect `/api/go?url=` | No | **junior-code** |
| 6 | Open proxy `/api/proxy?url=` | No | **junior-code** (no SSRF primitive in Express) |
| 7 | Stack leak + HTML echo | No | **misconfig** + **junior-code** |
| 8 | Slow handler holds socket | No | **framework-gap** |
| 9 | `GET /api/users` full PII dump | No | **junior-code** / missing authz |
| 10 | IDOR `/api/users/:id` | No | **junior-code** |
| 11 | Debug config leaks JWT secret | No | **junior-code** |
| 12 | Account enumeration via login errors | No | **junior-code** |
| 13 | BOLA on `/api/orders` | Yes (any user) | **junior-code** — authn ≠ authz |
| 14 | Mass assignment `role: "admin"` | Yes | **junior-code** |
| 15 | Admin route without role check | Yes | **junior-code** + no authz primitive |
| 16 | Forged JWT after secret leak | After leak | Weak secret + leak surface |
| 17 | Unauth `PUT /api/settings` | No | **junior-code** |

**Honest gap for any framework:** ownership rules
(`order.userId === req.user.sub`) are still **your** code. Defaults only close
transport and foot-gun classes.

Optional after-talk note: secure-by-default frameworks (e.g. body limits, rate
limits, headers, schemas, fail-closed auth hooks) shrink the junior blast radius.
They are a **30-second close**, not a running commentary during the attack.

---

## The story you tell the audience

1. Open the live API: `GET /api/health` → `"express":"5"`.
2. “Tutorial stack: Express 5 + JWT login. Deployed for public use.”
3. Terminal (Enter between phases):

   ```bash
   node attack/attack.mjs https://vaultpay-api.YOUR-SUBDOMAIN.workers.dev --drama
   # if DEMO_GATE_TOKEN is set on the server:
   node attack/attack.mjs https://… --drama --gate=talk-day-secret
   ```

4. Watch unauth probes first, then PII theft, then authz collapse and forged admin JWT.
5. Punchline: **Authn ≠ authz**, **edge ≠ API security**, **nothing is not a security model**.
6. Expand **CF vs Vercel** for 30–45 min slots ([`TALK.md`](TALK.md)).

Full scripts: **[`TALK.md`](TALK.md)**.

---

## Local quick start

```bash
# One command (boots server, runs attack, exits)
npm install --prefix server
npm run demo              # vulnerable → API PWNED
npm run demo:hardened     # green run → 0 critical

# Or two terminals
cd server && npm start
# other terminal, repo root:
node attack/attack.mjs http://localhost:4000 --drama --reset --projector
```

| Mode | How | Attack expectation |
| --- | --- | --- |
| Vulnerable (default) | `npm start` / `npm run demo` | Many CRITICAL, forged admin JWT |
| Hardened | `HARDENED=1` / `npm run demo:hardened` | **0 critical** |

| Email | Password | Role |
| --- | --- | --- |
| `alice@example.com` | `password123` | user |
| `bob@example.com` | `bobsecret` | user |
| `admin@vaultpay.demo` | `admin123` | admin |

(The attack script uses these automatically.)

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

Deploy the **`server/`** folder (Node 18+). Startup: `node server.js`.
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
  attack/attack.mjs
  server/
  tests/
  README.md
```

---

## How to attack (step by step)

**[`HOW-TO-ATTACK.md`](HOW-TO-ATTACK.md)** — full env vars, local / Cloudflare /
Vercel / Azure paths, Zscaler TLS notes, talk-day checklist.

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"   # Zscaler only
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama
node attack/attack.mjs https://vaultpay-api.vercel.app --drama
```

## Attack script console output

Wire logging is **on by default**. Findings show severity, OWASP id, and kind.

```text
  → SEND  #12  GET /api/users
  ← RECV  #12  200  18ms
  ✗ APP HOLE       Returned 4 full accounts without auth
   LOOT  #1 alice@example.com  ...
  [CRITICAL] [API1] (junior-code) Unauthenticated user dump
  [Enter] continue…
```

| Flag | Use |
| --- | --- |
| (default) | Phases, wire logs, LOOT, scoreboard |
| `--verbose` | Response body previews |
| `--drama` | **Wait for Enter** between phases (talk control) |
| `--projector` | No dim text, less wire noise (big rooms) |
| `--reset` | `POST /api/demo/reset` first (warm-isolate hygiene) |
| `--gate=TOKEN` | Send `X-VaultPay-Demo` (or set `DEMO_GATE_TOKEN` env) |
| `--quiet` | Less color / wire noise |
| `--skip-flood` | Skip 40-way login burst |
| `--skip-slow` | Skip `/api/slow` |
| `--json` | Machine-readable findings at end |

---

## Ethics & license

Sample PII/cards/SSNs are fake. **Do not** aim `attack.mjs` at third-party systems.
**Tear down or gate** public deploys after the talk — see [`TEARDOWN.md`](TEARDOWN.md).

MIT + educational-use notice: [`LICENSE`](LICENSE).
