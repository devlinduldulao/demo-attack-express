# Attack run study — Vercel (Express 5)

**Target:** `https://vaultpay-api.vercel.app`  
**Stack:** **Express 5** + JWT (intentionally vulnerable VaultPay)  
**Runtime:** `vercel-serverless` (from `/api/debug/config`)  
**Deployed:** 2026-08-01 — local `vercel --prod --yes`  
**Health:** `{"ok":true,"service":"vaultpay-api","express":"5"}`  
**Reset proof:** `POST /api/demo/reset` → includes `prototypeKeysCleared`  
**Attack:** 2026-08-01T10:09Z · `node attack/attack.mjs URL --reset --json`  
(no `--internal`)

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"   # Zscaler only if needed
node attack/attack.mjs https://vaultpay-api.vercel.app --reset --json
```

**Result:** `DEMO RESULT: API PWNED — 11 critical findings · 74 requests · 11.1s`  
**By severity:** `CRITICAL: 11` · `HIGH: 8` · `MEDIUM: 4` · `INFO: 1` (**24** findings)  
**By kind:** `junior-code: 17` · `framework-gap: 4` · `misconfig: 3`  
**OWASP API:** API1, API2, API3, API4, API5, API7, API8  
**Loot:** 4 users · 5+ orders · JWT secret **YES** · privilege esc **YES** · forged admin **YES**  
**Platform notes:** IMDS empty (expected off EC2)

Raw log (local, gitignored): `ATTACK-RUN-VERCEL-LATEST.log`  
Cloudflare sister: [`ATTACK-RUN-CLOUDFLARE.md`](ATTACK-RUN-CLOUDFLARE.md)

---

## 1. Bottom line

| Question | Answer |
| --- | --- |
| Current code on Vercel? | **Yes** — reset cleanup field present; no hardened mode |
| Unauth PII / secret / traversal? | **CRITICAL** |
| Prototype pollution empty order? | **CRITICAL** — LOOT `ATTACKER PAYOUT LTD $31337` |
| BOLA / mass-assign / BFLA / forge? | **CRITICAL** all landed |
| `alg:none`? | **Rejected 401** — jsonwebtoken v9 pins HS256 for string secrets |
| Self-SSRF open proxy? | **CRITICAL** (unlike CF 1042) |

This is the **full chain** live cloud run for the current attack script.

---

## 2. CRITICAL (11)

| Finding | kind | OWASP |
| --- | --- | --- |
| Path traversal reads server secret files | junior-code | API1 |
| SSRF open proxy can reach internal URLs | junior-code | API7 |
| Unauthenticated user dump | junior-code | API1 |
| IDOR on `/api/users/:id` without auth | junior-code | API1 |
| Debug endpoint leaks JWT signing secret | junior-code | API8 |
| Prototype pollution via unauthenticated deep merge | junior-code | API3 |
| BOLA on `/api/orders` | junior-code | API1 |
| Mass assignment privilege escalation | junior-code | API3 |
| Cross-user write without ownership check | junior-code | API1 |
| Admin route checks login only, not role | junior-code | API5 |
| Forged JWTs accepted (weak/leaked secret) | junior-code | API2 |

---

## 3. HIGH (8) highlights

| Finding | kind | Notes |
| --- | --- | --- |
| CORS misconfig allows any browser origin | misconfig | `ACA-Origin: *` |
| Demo misconfig: custom ~50mb bodies | misconfig | not Express `json()` 100kb default |
| No rate limiting on authentication | framework-gap | 40×401, zero 429 |
| Open redirect | junior-code | |
| Open proxy no egress allowlist (IMDS-class) | junior-code | 502 upstream; class still recorded |
| HTML echo XSS class | junior-code | |
| Unauthenticated PII search | junior-code | |
| Unauthenticated settings write | junior-code | |

**MEDIUM:** secure-headers gap, stack leak misconfig, request-timeout gap, login enumeration  
**INFO:** `X-Powered-By: Express`

---

## 4. Edge / platform (this run)

| Probe | Vercel |
| --- | --- |
| HSTS | Often present on edge (header audit may still flag missing app CSP/XFO) |
| Self-proxy → debug | **Works** → secret in body |
| IMDS `169.254.169.254` | **502** · platform note + HIGH no allowlist |
| Internal pivot (`--internal`) | Not used — laptop loopback not reachable from Vercel |

---

## 5. Prototype pollution (headline)

```text
✓ OK        Empty order body rejected (before pollution)
·           PUT /api/settings with __proto__ → 200
✗ APP HOLE  Empty JSON body created a transaction — values from the prototype
 LOOT       forged-order  #6 ATTACKER PAYOUT LTD $31337
```

Unlike Cloudflare Workers, pollution **does not** brick the Vercel instance for the rest of the run. Login and forge still complete. Use `--reset` between rehearsals so pollution does not stick in a warm isolate.

---

## 6. Compare to previous study (2026-07-31)

| | Prior | This engagement (2026-08-01) |
| --- | --- | --- |
| Critical | 10 | **11** |
| Findings | ~21 | **24** |
| Requests / elapsed | 67 · ~10s | **74 · 11.1s** |
| New vs prior | — | CORS, IMDS-class, **prototype pollution**, `alg:none` green check |
| Forged admin | YES | **YES** |

---

## 7. Talk takeaway

Same incomplete Express + JWT app as Cloudflare. On Vercel you get the **full** story: unauth dump → pollution forged order → BOLA → mass-assign → forged admin. Cloudflare still proves unauth + secret leak + edge notes; use both for “platform ≠ authz,” prefer Vercel for the complete climax.
