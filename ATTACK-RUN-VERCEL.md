# Attack run study — Vercel (Express 5)

**Target:** `https://vaultpay-api.vercel.app`  
**Stack:** **Express 5** + JWT (intentionally vulnerable VaultPay)  
**Runtime:** `vercel-serverless` (from `/api/debug/config`)  
**Deployed:** 2026-08-01 — local `vercel --prod --yes`  
**Health:** `{"ok":true,"service":"vaultpay-api","express":"5"}`  
**Attack:** 2026-08-01 · `node attack/attack.mjs URL --reset --json`  
(no `--internal`)

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"   # Zscaler only if needed
node attack/attack.mjs https://vaultpay-api.vercel.app --reset --json
# stage pacing:
node attack/attack.mjs https://vaultpay-api.vercel.app --drama --reset
```

**Result:** `DEMO RESULT: API PWNED — 10 critical findings · 70 requests · 10.1s`  
**By severity:** `CRITICAL: 10` · `HIGH: 8` · `MEDIUM: 4` · `INFO: 1` (**23** findings)  
**By kind:** `app-code: 16` · `framework-gap: 4` · `misconfig: 3`  
**OWASP API:** API1, API2, API3, API4, API5, API7, API8  
**Loot:** 4 users · JWT secret **YES** · privilege esc **YES** · forged admin **YES**  
**`alg:none`:** rejected (401) — jsonwebtoken v9 pins HS256 for string secrets  

Raw log (local, gitignored): `ATTACK-RUN-VERCEL-LATEST.log`  
Cloudflare sister: [`ATTACK-RUN-CLOUDFLARE.md`](ATTACK-RUN-CLOUDFLARE.md)

---

## 1. Bottom line

| Question | Answer |
| --- | --- |
| Current code on Vercel? | **Yes** |
| Unauth PII / IDOR / secret / traversal? | **CRITICAL** |
| Self-SSRF open proxy → debug? | **CRITICAL** (unlike CF 1042) |
| BOLA / mass-assign / BFLA / forge? | **CRITICAL** — full climax |
| CORS / body / flood? | **HIGH** as labelled |
| IMDS-class URL? | 502 / no IMDS · **HIGH** no allowlist |

This is the **full chain** on a public free-tier host.

---

## 2. CRITICAL (10)

| Finding | kind | OWASP |
| --- | --- | --- |
| Path traversal reads server secret files | app-code | API1 |
| SSRF open proxy can reach internal URLs | app-code | API7 |
| Unauthenticated user dump | app-code | API1 |
| IDOR on `/api/users/:id` without auth | app-code | API1 |
| Debug endpoint leaks JWT signing secret | app-code | API8 |
| BOLA on `/api/orders` | app-code | API1 |
| Mass assignment privilege escalation | app-code | API3 |
| Cross-user write without ownership check | app-code | API1 |
| Admin route checks login only, not role | app-code | API5 |
| Forged JWTs accepted (weak/leaked secret) | app-code | API2 |

(+1 critical vs CF is **self-SSRF returning the debug secret**.)

---

## 3. HIGH (8)

| Finding | kind |
| --- | --- |
| CORS misconfig allows any browser origin | misconfig |
| Demo misconfig: custom ~50mb bodies | misconfig |
| No rate limiting on authentication | framework-gap |
| Open redirect | app-code |
| Open proxy no egress allowlist (IMDS-class) | app-code |
| HTML echo XSS class | app-code |
| Unauthenticated PII search | app-code |
| Unauthenticated settings write | app-code |

**MEDIUM / INFO:** same family as CF (headers, stack misconfig, timeout, enum, x-powered-by).

---

## 4. Edge / platform (this run)

| Probe | Vercel |
| --- | --- |
| Self-proxy → `/api/debug/config` | **200** + `jwtSecret` |
| IMDS `169.254.169.254` | no real IMDS · platform note |
| HSTS | often present on edge; app still missing CSP/XFO/nosniff |

---

## 5. Compare to Cloudflare (same attacker, same day)

| | Cloudflare | Vercel |
| --- | --- | --- |
| Critical | **9** | **10** |
| Requests / time | 71 · 4.3s | 70 · 10.1s |
| Forged admin | YES | YES |
| Self-SSRF secret | No (1042) | **YES** |

---

## 6. Talk takeaway

Same incomplete Express + JWT app. Vercel adds the self-SSRF secret path; both still dump PII and accept a forged admin JWT. **Hosting platform ≠ API security.**
