# Attack run study — Cloudflare Workers (Express 5)

**Target:** `https://vaultpay-api.devlinduldulao.workers.dev`  
**Stack:** **Express 5** + JWT (intentionally vulnerable VaultPay)  
**Deployed:** 2026-08-01 — local `wrangler deploy`  
**Worker Version ID:** `46b0d6b3-8d54-4217-8eac-c9c28dffbe09`  
**Health:** `{"ok":true,"service":"vaultpay-api","express":"5"}`  
**Attack:** 2026-08-01 · `node attack/attack.mjs URL --reset --json`  
(no `--internal`; no prototype-pollution phase in current attacker)

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"   # Zscaler only if needed
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --reset --json
# stage pacing:
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama --reset
```

**Result:** `DEMO RESULT: API PWNED — 9 critical findings · 71 requests · 4.3s`  
**By severity:** `CRITICAL: 9` · `HIGH: 9` · `MEDIUM: 4` · `INFO: 1` (**23** findings)  
**By kind:** `junior-code: 16` · `framework-gap: 4` · `misconfig: 3`  
**OWASP API:** API1, API2, API3, API4, API5, API7, API8  
**Loot:** 4 users · JWT secret **YES** · privilege esc **YES** · forged admin **YES**  
**`alg:none`:** rejected (401) — jsonwebtoken v9 pins HS256 for string secrets  

Raw log (local, gitignored): `ATTACK-RUN-CLOUDFLARE-LATEST.log`  
Sister study: [`ATTACK-RUN-VERCEL.md`](ATTACK-RUN-VERCEL.md) · [`PLATFORM-COMPARISON.md`](PLATFORM-COMPARISON.md)

---

## 1. Bottom line

| Question | Answer |
| --- | --- |
| Current code on CF? | **Yes** (version above) |
| Unauth PII / IDOR / secret / traversal? | **CRITICAL** |
| BOLA / mass-assign / BFLA / forge? | **CRITICAL** — full climax |
| Self-SSRF open proxy? | **Blocked** CF **1042** → external open proxy still **HIGH** |
| IMDS-class URL? | No real IMDS · **HIGH** no egress allowlist + `◇ PLATFORM` |
| CORS `*`? | **HIGH** misconfig |

---

## 2. CRITICAL (9)

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

---

## 3. HIGH (9)

| Finding | kind | Notes |
| --- | --- | --- |
| CORS misconfig allows any browser origin | misconfig | `ACA-Origin: *` |
| Demo misconfig: custom ~50mb bodies | misconfig | not Express `json()` 100kb default |
| No rate limiting on authentication | framework-gap | 40×401, zero 429 |
| Open redirect | junior-code | |
| Open proxy: arbitrary external URLs | junior-code | after CF 1042 self-block |
| Open proxy no egress allowlist (IMDS-class) | junior-code | app did not refuse link-local URL |
| HTML echo XSS class | junior-code | |
| Unauthenticated PII search | junior-code | |
| Unauthenticated settings write | junior-code | |

**MEDIUM:** missing secure headers, stack leak misconfig, no app request timeout, login enumeration  
**INFO:** `X-Powered-By: Express`

---

## 4. Platform notes (this run)

| Probe | CF result |
| --- | --- |
| Self `/api/proxy` → debug | **1042** — edge/runtime, not app authz |
| External open proxy (`example.com`) | **HIGH** — still works |
| IMDS `169.254.169.254` | no IMDS data · `◇ PLATFORM` |
| Internal pivot (`--internal`) | not used (API cannot reach your laptop from CF) |

---

## 5. Phase order (current attacker)

Reset → recon → headers → CORS → body → flood → traversal → redirect → SSRF → stack/echo → slow → unauth theft → enum → settings → raw TCP (skip HTTPS) → **login / BOLA / mass-assign / admin / alg:none / forge**

With `--drama`, each phase waits for **Enter**.

---

## 6. Talk takeaway

Cloudflare free edge blocked **noisy self-SSRF** and has no real IMDS. It did **not** stop unauth card dump, secret leak, BOLA, mass-assign, or forged admin. **Edge ≠ API authorization.**
