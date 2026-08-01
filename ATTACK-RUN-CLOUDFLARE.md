# Attack run study — Cloudflare Workers (Express 5)

**Target:** `https://vaultpay-api.devlinduldulao.workers.dev`  
**Stack under test:** **Express 5** + JWT (intentionally vulnerable VaultPay demo)  
**Deployed:** 2026-07-31 (local `wrangler deploy` from current `server/`)  
**Attack started:** 2026-07-31T20:07:51Z  
**Attacker flags:** `--reset --json` (full flood + slow; no gate)

```powershell
# From this repo root (Zscaler laptop only if cert errors)
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --reset --json
```

**Result:** `DEMO RESULT: API PWNED — 9 critical findings · 68 requests · 4.6s`  
**By severity:** `CRITICAL: 9` · `HIGH: 7` · `MEDIUM: 4` · `INFO: 1` (21 findings)  
**By kind:** `junior-code: 15` · `framework-gap: 4` · `misconfig: 2`  
**OWASP API:** API1, API2, API3, API4, API5, API7, API8  
**Loot:** 4 users, 5 orders, JWT secret `supersecret123`, privilege esc **YES**, forged admin **YES**

Raw console capture (local only, gitignored): `ATTACK-RUN-CLOUDFLARE-LATEST.log`  
Sister study: [`ATTACK-RUN-VERCEL.md`](ATTACK-RUN-VERCEL.md) · comparison: [`PLATFORM-COMPARISON.md`](PLATFORM-COMPARISON.md)

---

## 1. Bottom line

| Question | Answer |
| --- | --- |
| Is production Express 5? | **Yes.** Health: `"express":"5"`. |
| Did JWT make the API “secure”? | **No.** Most damage needed **no password**. |
| Did the demo work after code refresh? | **Yes.** Reset → PII → secret → BOLA → mass-assign → **forged admin last**. |
| What underperformed? | **Cloudflare platform** blocked self-SSRF (`1042`). Mild HTML echo still proved the XSS sink. Not Express learning security. |
| Honest labels? | Body limit + stack leak = **misconfig**. Headers / flood / timeout / x-powered-by = **framework-gap**. JWT chain = **junior-code**. |

---

## 2. Phase order (current attack script)

Climax is **last** (Phase 15). Settings + raw TCP are no longer after forgery.

| Phase | Title | Outcome on CF (this run) |
| --- | --- | --- |
| 01 | Demo reset | `POST /api/demo/reset` → ok (clean Alice/Bob) |
| 02 | Recon | Health 200 |
| 03 | Missing secure headers | **MEDIUM** framework-gap + **INFO** x-powered-by |
| 04 | Oversized body (~1.5 MiB) | **HIGH** misconfig (401, not 413) |
| 05 | Login flood ×40 | **HIGH** framework-gap — histogram `{"401":40}`, 0×429, ~404 ms |
| 06 | Path traversal | **CRITICAL** API1 — `JWT_SECRET=supersecret123` |
| 07 | Open redirect | **HIGH** API8 |
| 08 | Open proxy / SSRF | Self → **◇ PLATFORM** 1042; external example.com → **HIGH** API7 |
| 09 | Stack + HTML echo | Stack **MEDIUM** misconfig; mild HTML **HIGH** junior-code (no WAF on mild) |
| 10 | Slow handler | **MEDIUM** framework-gap (~3 s hang) |
| 11 | Unauth data theft | **CRITICAL** dump, IDOR, debug secret; **HIGH** PII search |
| 12 | Account enumeration | **MEDIUM** API2 |
| 13 | Unauth settings write | **HIGH** API3 |
| 14 | Raw TCP | Skipped (HTTPS) |
| 15 | Login, BOLA, mass-assign, admin, **forge** | **CRITICAL** ×5 — ends on forged admin JWT |

---

## 3. How to read the console

```text
WHY      intent (framework-gap / misconfig / junior-code)
»        narration
→ SEND   request
← RECV   response
✗ APP HOLE / ◇ PLATFORM / ✓ OK
LOOT     stolen material
[SEV] [APIn] (kind)  finding title
scoreboard  running counts
```

Thesis line on banner:

> JWT is not a security model. Frameworks give you almost nothing — and nothing is not a security model.

---

## 4. Finding inventory (this run)

### CRITICAL (9)

| Finding | kind | OWASP |
| --- | --- | --- |
| Path traversal reads server secret files | junior-code | API1 |
| Unauthenticated user dump | junior-code | API1 |
| IDOR on `/api/users/:id` without auth | junior-code | API1 |
| Debug endpoint leaks JWT signing secret | junior-code | API8 |
| BOLA on `/api/orders` | junior-code | API1 |
| Mass assignment privilege escalation | junior-code | API3 |
| Cross-user write without ownership check | junior-code | API1 |
| Admin route checks login only, not role | junior-code | API5 |
| Forged JWTs accepted (weak/leaked secret) | junior-code | API2 |

### HIGH (7)

| Finding | kind | OWASP | Notes |
| --- | --- | --- | --- |
| Demo misconfig: custom parser ~50mb | misconfig | API4 | Express `json()` default is 100kb |
| No rate limiting on authentication | framework-gap | API4 | 40×401, zero 429 |
| Open redirect | junior-code | API8 | |
| Open proxy external fetch | junior-code | API7 | Self blocked by CF 1042 |
| HTML echo XSS class (mild) | junior-code | API8 | `<b>vaultpay-reflected</b>` |
| Unauthenticated PII search | junior-code | API3 | |
| Unauthenticated settings write | junior-code | API3 | |

### MEDIUM (4) + INFO (1)

| Finding | kind | OWASP |
| --- | --- | --- |
| No application secure-headers middleware | framework-gap | API8 |
| Custom error handler leaks stack | misconfig | API8 |
| No application request-timeout budget | framework-gap | API4 |
| Login error enumeration | junior-code | API2 |
| X-Powered-By: Express left enabled | framework-gap | — |

---

## 5. Platform note (only CF difference that matters)

```text
◇ PLATFORM  Self-fetch blocked by Cloudflare (error 1042) — not app authz
```

- Self-URL via `/api/proxy` → **404** body `error code: 1042`  
- Fallback `https://example.com/` → **200** open proxy (**HIGH**, not CRITICAL self-SSRF)  
- On Vercel, the same self-proxy is **CRITICAL** (returns `jwtSecret`)

Mild HTML echo was **not** WAF-blocked on this run (unlike older noisy `onerror=alert` probes).

---

## 6. What this proves for the talk

1. **Authn ≠ authz** — JWT thesis chain intact.  
2. **Edge ≠ API security** — 1042 does not stop card dump or forge.  
3. **Labels are honest** — body/stack are misconfig, not “Express defaults.”  
4. **Elapsed 4.6s / 68 requests** — quoteable after the demo.  
5. **Forgery last** — report climax matches the last LOOT on screen.

