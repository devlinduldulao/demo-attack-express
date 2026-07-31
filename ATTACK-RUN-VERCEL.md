# Attack run study — Vercel (Express 5)

**Target:** `https://vaultpay-api.vercel.app`  
**Stack:** **Express 5** + JWT (VaultPay, intentionally vulnerable)  
**Runtime:** `vercel-serverless` (from `/api/debug/config`)  
**Health proof:** `GET /api/health` → `"express":"5"`  
**Deploy:** local `vercel --prod --yes` from `server/` (not GitHub integration)  
**Attack:** 2026-07-31 (after multi-instance mass-assign fix in attacker)

```powershell
# Repo root
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"   # Zscaler laptop only
node attack/attack.mjs https://vaultpay-api.vercel.app --json
```

**Result:** `DEMO RESULT: API PWNED — 10 critical findings · 65 requests`  
**By severity:** `CRITICAL: 10` · `HIGH: 6` · `MEDIUM: 3`  
**Platform notes:** none (unlike Cloudflare self-SSRF / noisy XSS)

Raw console captures are local-only (`ATTACK-RUN-*-LATEST.log` is gitignored).  
Cloudflare sister study: [`ATTACK-RUN-CLOUDFLARE.md`](ATTACK-RUN-CLOUDFLARE.md)

---

## 1. Bottom line

| Question | Answer |
| --- | --- |
| Is Vercel prod Express 5? | **Yes** — health `"express":"5"`, runtime `vercel-serverless` |
| Private GitHub needed? | **No** — deploy was **local CLI → Vercel**, same idea as `wrangler deploy` |
| JWT enough? | **No** — unauth dump + forge admin |
| Edge saved the API? | **No** — Vercel did **not** block mild XSS or open-proxy self-fetch in this run |
| Demo quality | **Excellent** — 10 critical, including SSRF CRITICAL (stronger than CF self-fetch) |

**Talk sound bite:**

> “Same Express 5 app on Vercel serverless. Cloudflare blocked two noisy probes earlier. On Vercel the open proxy returned our JWT secret, HTML reflection worked, and we still forged admin. Platform ≠ authorization.”

---

## 2. Deploy record

```text
cd server
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"   # if corporate TLS
vercel whoami                             # devlinduldulao
vercel --prod --yes
# Created project: devlin-duldulaos-projects/vaultpay-api
# Aliased: https://vaultpay-api.vercel.app
# Ready in ~16s
```

Smoke:

```json
{"ok":true,"service":"vaultpay-api","express":"5","time":"..."}
```

Debug config (also stolen via SSRF and unauth GET):

```json
{
  "env": "production",
  "runtime": "vercel-serverless",
  "jwtSecret": "supersecret123",
  "bodyLimit": "50mb",
  "database": "in-memory"
}
```

---

## 3. Scoreboard (this engagement)

| Metric | Value |
| --- | --- |
| HTTP requests | 65 |
| Findings | 19 |
| CRITICAL | **10** |
| HIGH | **6** |
| MEDIUM | **3** |
| Users stolen | 4 |
| Orders stolen | 5 |
| JWT secret | `supersecret123` |
| Privilege escalation | **YES** |
| Forged admin | **YES** |
| Platform notes | **0** |

### Findings list

| Sev | Title |
| --- | --- |
| MEDIUM | No secure response headers (HSTS **present** from Vercel edge; others missing) |
| HIGH | Oversized JSON body accepted (~1.5 MiB → 401, not 413) |
| HIGH | No rate limiting on authentication (40× 401, 0× 429) |
| CRITICAL | Path traversal reads server secret files |
| HIGH | Open redirect |
| CRITICAL | SSRF open proxy can reach internal URLs (**self-URL worked**) |
| MEDIUM | Production-style stack traces exposed |
| HIGH | Reflected HTML echo sink (XSS class) — mild payload worked |
| MEDIUM | No requestTimeoutMs — slow handler ~3s |
| CRITICAL | Unauthenticated user dump |
| CRITICAL | IDOR on `/api/users/:id` |
| CRITICAL | Debug endpoint leaks JWT signing secret |
| HIGH | Unauthenticated PII search |
| MEDIUM | Login error messages enable account enumeration |
| CRITICAL | BOLA on `/api/orders` |
| CRITICAL | Mass assignment privilege escalation |
| CRITICAL | Cross-user write without ownership check |
| CRITICAL | Admin route checks login only, not role |
| CRITICAL | Forged JWTs accepted (weak/leaked secret) |
| HIGH | Unauthenticated settings write |

---

## 4. Phase highlights (Vercel-specific)

| Phase | Vercel observation |
| --- | --- |
| Headers | **HSTS** set by platform (`max-age=63072000; includeSubDomains; preload`). App still missing CSP, XFO, nosniff, etc. |
| Body 1.5 MiB | Accepted (~1170ms) — not 413 |
| Flood | 40× 401 in ~889ms, no 429 |
| Path traversal | Works — secret file LOOT |
| Open redirect | 302 to evil host |
| **SSRF self** | **200 + jwtSecret** — unlike Cloudflare 1042 |
| **HTML echo** | Mild `<b>vaultpay-reflected</b>` reflected — unlike CF noisy XSS 403 |
| Slow 3s | 200 in ~3176ms (within Vercel maxDuration) |
| Unauth dump | Full PII |
| Mass assign | Seed user Alice — works on multi-instance (after attacker fix) |
| Cross-user | Alice → Bob seed users |
| Forge admin | Works |

### Serverless in-memory caveat

Vercel runs **multiple isolates**. A `POST /register` on instance A then `PUT /users/:newId` on instance B can 404.

**Attacker fix:** mass-assign and cross-user-write use **seed users** (Alice #1, Bob #2) present on every cold start. Disposable register+mutate is flaky here — document as a real multi-instance lesson:

> In-memory DB on serverless is not just “resets on deploy” — it is **not shared across concurrent instances**.

---

## 5. Vercel vs Cloudflare (same Express 5 app)

| Probe | Cloudflare Workers | Vercel serverless |
| --- | --- | --- |
| Express 5 live | Yes | Yes |
| Unauth PII / IDOR / debug secret | CRITICAL | CRITICAL |
| Path traversal secret | CRITICAL | CRITICAL |
| BOLA / admin / forge JWT | CRITICAL | CRITICAL |
| Login flood | No 429 | No 429 |
| 1.5 MiB body | Accepted | Accepted |
| Open redirect | Yes | Yes |
| SSRF to own debug URL | **CF 1042** (platform) | **Works — CRITICAL** |
| Mild HTML XSS sink | Works (after mild payload) | Works |
| Noisy XSS `onerror=alert` | Often **WAF 403** | Not required (mild worked) |
| HSTS header | Often missing in our CF run | **Present (edge)** |
| Mass-assign seed user | Yes | Yes (seed users) |
| In-memory multi-instance | Worker isolates | **Noticeable** (register race) |

**Lesson:** swapping hosts does not fix authz. Sometimes the **edge is less helpful** (Vercel allowed SSRF self-fetch and HTML echo).

---

## 6. Environment / GitHub

| Topic | Fact |
| --- | --- |
| Private GitHub | **Not required** for this deploy |
| Deploy path | Local machine → `vercel --prod` (like `wrangler deploy`) |
| Zscaler | `NODE_TLS_REJECT_UNAUTHORIZED=0` needed for CLI + Node fetch on this laptop |
| Project | `devlin-duldulaos-projects/vaultpay-api` |
| Alias | `https://vaultpay-api.vercel.app` |

---

## 7. Reproduce

```powershell
cd server
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
vercel --prod --yes
cd ..

Invoke-RestMethod https://vaultpay-api.vercel.app/api/health

$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node attack/attack.mjs https://vaultpay-api.vercel.app --drama
```

Deploy notes: [`server/DEPLOY-VERCEL.md`](server/DEPLOY-VERCEL.md)  
Platform comparison: [`PLATFORM-COMPARISON.md`](PLATFORM-COMPARISON.md)

---

## 8. Cheat sheet ★

```text
VERCEL + EXPRESS 5 — this engagement

NO LOGIN
  headers (minus HSTS)     MEDIUM
  1.5MB body               HIGH
  40 logins no 429         HIGH
  path traversal secret    CRITICAL  ★
  open redirect            HIGH
  SSRF self → jwtSecret    CRITICAL  ★  (stronger than CF)
  stack traces             MEDIUM
  HTML echo XSS class      HIGH      ★
  slow ~3s                 MEDIUM
  /api/users dump          CRITICAL  ★
  IDOR / debug / search     CRITICAL / HIGH
  login enum               MEDIUM
  PUT /api/settings        HIGH

ANY USER JWT
  BOLA orders              CRITICAL  ★
  mass assign admin        CRITICAL  ★
  cross-user write         CRITICAL  ★
  admin stats passwords    CRITICAL  ★

LEAKED SECRET
  forge admin JWT          CRITICAL  ★

Vercel edge helped: HSTS only (in this run)
Vercel edge did NOT stop: the whole authz story
```

---

*Educational only. Express 5 on Vercel serverless. Attack only systems you own.*
