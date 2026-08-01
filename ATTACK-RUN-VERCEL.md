# Attack run study — Vercel (Express 5)

**Target:** `https://vaultpay-api.vercel.app`  
**Stack:** **Express 5** + JWT (VaultPay, intentionally vulnerable)  
**Runtime:** `vercel-serverless` (from `/api/debug/config`)  
**Health proof:** `GET /api/health` → `"express":"5"`  
**Deploy:** local `vercel --prod --yes` from `server/` (2026-07-31, current tree)  
**Attack:** 2026-07-31T20:07:56Z · flags `--reset --json`

```powershell
# Repo root
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"   # Zscaler laptop only
node attack/attack.mjs https://vaultpay-api.vercel.app --reset --json
```

**Result:** `DEMO RESULT: API PWNED — 10 critical findings · 67 requests · 10.0s`  
**By severity:** `CRITICAL: 10` · `HIGH: 6` · `MEDIUM: 4` · `INFO: 1` (21 findings)  
**By kind:** `junior-code: 15` · `framework-gap: 4` · `misconfig: 2`  
**OWASP API:** API1, API2, API3, API4, API5, API7, API8  
**Loot:** 4 users, 5 orders, JWT secret **YES**, privilege esc **YES**, forged admin **YES**  
**Platform notes:** none (full open proxy self-fetch)

Raw console capture (local only, gitignored): `ATTACK-RUN-VERCEL-LATEST.log`  
Cloudflare sister study: [`ATTACK-RUN-CLOUDFLARE.md`](ATTACK-RUN-CLOUDFLARE.md)

---

## 1. Bottom line

| Question | Answer |
| --- | --- |
| Is Vercel prod Express 5? | **Yes** — health `"express":"5"`, runtime `vercel-serverless` |
| Private GitHub needed? | **No** — deploy was **local CLI → Vercel** |
| Same app as Cloudflare? | **Yes** — same `server/app.js` source |
| Why 10 critical vs CF’s 9? | **Self-SSRF open proxy** returns debug `jwtSecret` here (CF blocks self-fetch with 1042) |
| Climax | Phase 15 forged admin JWT (settings/raw run earlier) |

---

## 2. Phase order (same script as CF)

| Phase | Title | Outcome on Vercel (this run) |
| --- | --- | --- |
| 01 | Demo reset | ok |
| 02 | Recon | Health 200 |
| 03 | Headers | HSTS **present** (edge); still missing CSP/XFO/nosniff; **x-powered-by: Express** |
| 04 | Oversized body | **HIGH** misconfig — ~1.5 MiB accepted |
| 05 | Login flood ×40 | **HIGH** — `{"401":40}`, 0×429, ~1075 ms |
| 06 | Path traversal | **CRITICAL** |
| 07 | Open redirect | **HIGH** |
| 08 | Open proxy / SSRF | **CRITICAL** self-fetch of `/api/debug/config` + secret |
| 09 | Stack + HTML echo | **MEDIUM** stack misconfig; **HIGH** mild HTML XSS sink |
| 10 | Slow handler | **MEDIUM** ~3 s |
| 11 | Unauth data theft | **CRITICAL** dump / IDOR / debug; **HIGH** search |
| 12 | Account enumeration | **MEDIUM** |
| 13 | Settings write | **HIGH** |
| 14 | Raw TCP | Skipped (HTTPS) |
| 15 | Authz + forge | **CRITICAL** ×5 — ends on forged admin |

---

## 3. Finding inventory (this run)

### CRITICAL (10)

| Finding | kind | OWASP |
| --- | --- | --- |
| Path traversal reads server secret files | junior-code | API1 |
| **SSRF open proxy can reach internal URLs** | junior-code | API7 |
| Unauthenticated user dump | junior-code | API1 |
| IDOR on `/api/users/:id` without auth | junior-code | API1 |
| Debug endpoint leaks JWT signing secret | junior-code | API8 |
| BOLA on `/api/orders` | junior-code | API1 |
| Mass assignment privilege escalation | junior-code | API3 |
| Cross-user write without ownership check | junior-code | API1 |
| Admin route checks login only, not role | junior-code | API5 |
| Forged JWTs accepted (weak/leaked secret) | junior-code | API2 |

### HIGH (6)

| Finding | kind | OWASP |
| --- | --- | --- |
| Demo misconfig: custom parser ~50mb | misconfig | API4 |
| No rate limiting on authentication | framework-gap | API4 |
| Open redirect | junior-code | API8 |
| HTML echo XSS class | junior-code | API8 |
| Unauthenticated PII search | junior-code | API3 |
| Unauthenticated settings write | junior-code | API3 |

### MEDIUM (4) + INFO (1)

Same as CF: secure-headers gap, stack misconfig, request-timeout gap, login enumeration, x-powered-by.

---

## 4. Vercel edge notes (this run)

| Edge behavior | Result |
| --- | --- |
| HSTS | **Present:** `max-age=63072000; includeSubDomains; preload` — does not fix authz |
| Self-SSRF via `/api/proxy` | **Allowed** — returns production debug JSON including `jwtSecret` |
| Mild HTML `/api/echo` | **200** text/html reflection |
| Login flood | No 429 from app or edge (40×401) |

LOOT excerpt from self-proxy:

```text
{"env":"production","runtime":"vercel-serverless","jwtSecret":"supersecret123",...}
```

---

## 5. Multi-instance note (unchanged)

In-memory DB is per-isolate. Mass-assign uses **seed Alice** so it does not depend on `register` sticky sessions. `--reset` re-seeds when the isolate accepts it (this run: ok).

---

## 6. Talk takeaway

Same Express 5 junior app as Cloudflare. Vercel adds HSTS and allows self-SSRF; Cloudflare blocks self-fetch and still loses to unauth PII and forged JWT. **Hosting platform ≠ API security.**

Elapsed quote: **10.0s · 67 requests · 10 critical**.
