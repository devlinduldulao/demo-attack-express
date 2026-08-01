# Attack run study — Cloudflare Workers (Express 5)

**Target:** `https://vaultpay-api.devlinduldulao.workers.dev`  
**Stack:** **Express 5** + JWT (intentionally vulnerable VaultPay)  
**Deployed:** 2026-08-01 — local `wrangler deploy`  
**Worker Version ID:** `fa70392f-4175-4922-a355-b4e3046bfc4d`  
**Health:** `{"ok":true,"service":"vaultpay-api","express":"5"}` (no hardened mode)  
**Reset proof:** `POST /api/demo/reset` → `prototypeKeysCleared` present (empty when clean)  
**Attack:** 2026-08-01T10:09Z · `node attack/attack.mjs URL --reset --json`  
(no `--internal`)

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"   # Zscaler only if needed
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --reset --json
```

**Result:** `DEMO RESULT: API PWNED — 4 critical findings · 71 requests · 4.5s`  
**By severity:** `CRITICAL: 4` · `HIGH: 9` · `MEDIUM: 4` · `INFO: 1` (**18** findings)  
**By kind:** `junior-code: 11` · `framework-gap: 4` · `misconfig: 3`  
**OWASP API:** API1, API2, API3, API4, API7, API8  
**Loot:** 4 users · JWT secret **YES** · privilege esc **no** · forged admin **no**

Raw log (local, gitignored): `ATTACK-RUN-CLOUDFLARE-LATEST.log`  
Sister study: [`ATTACK-RUN-VERCEL.md`](ATTACK-RUN-VERCEL.md) · [`PLATFORM-COMPARISON.md`](PLATFORM-COMPARISON.md)

---

## 1. Bottom line

| Question | Answer |
| --- | --- |
| Current code on CF? | **Yes** — reset returns `prototypeKeysCleared`; health has no `hardened` |
| Unauth chain? | **Yes** — path traversal, user dump, IDOR, debug secret |
| Full JWT climax? | **No this run** — see Workers + prototype pollution note below |
| Edge vs app? | Self-SSRF **1042**; IMDS **403** (platform); open proxy still **HIGH** external |

### CRITICAL (4) this run

| Finding | kind | OWASP |
| --- | --- | --- |
| Path traversal reads server secret files | junior-code | API1 |
| Unauthenticated user dump | junior-code | API1 |
| IDOR on `/api/users/:id` without auth | junior-code | API1 |
| Debug endpoint leaks JWT signing secret | junior-code | API8 |

Secret was recovered, but **login + forge chain did not complete** (next section).

---

## 2. Workers landmine: prototype pollution → isolate 1101

After `PUT /api/settings` with `__proto__` / `merchant`+`amount`:

| Step | Result on CF Workers |
| --- | --- |
| Pollution request | **500** / Worker **error code: 1101** |
| Subsequent login / orders | **500 / 1101** until cleanup |
| `POST /api/demo/reset` | Clears `merchant`/`amount` off `Object.prototype` → isolate recovers |

So the **default** pollution phase (safe keys on Node/Vercel) **bricks the current Worker isolate** until reset. The attack script then cannot log in and **skips BOLA / mass-assign / forge** even though the JWT secret was already stolen via debug.

**Talk line:**

> “On Cloudflare, the same incomplete merge doesn’t just forge a fake order — it can take the isolate offline until reset. That’s still a configuration/code failure, not ‘the edge secured us.’”

**Stage ops:** always `--reset` (or hit reset) before a second CF run. Prefer **Vercel** (or local) if you need the full pollution + forge chain live.

Vercel sister run: **11 critical**, pollution **YES**, forged admin **YES**.

---

## 3. Other platform notes (this run)

| Probe | CF result |
| --- | --- |
| Self `/api/proxy` → debug | **1042** → external example.com **HIGH** open proxy |
| IMDS `169.254.169.254` | **403** · `◇ PLATFORM` + **HIGH** no egress allowlist |
| CORS `Origin: evil` | **HIGH** misconfig · `ACA-Origin: *` |
| Internal pivot / redirect hop | Skipped (no `--internal`; API cannot reach your laptop loopback from CF) |

---

## 4. HIGH / MEDIUM inventory (abbrev.)

**HIGH:** CORS `*`, 50 mb body misconfig, no login rate limit, open redirect, open proxy external, IMDS-class no allowlist, HTML echo, unauth PII search, unauth settings write  

**MEDIUM:** missing secure headers, stack leak misconfig, no app request timeout, login enumeration  

**INFO:** `X-Powered-By: Express`

---

## 5. Phase order (current script)

Reset → recon → headers → **CORS** → body → flood → traversal → redirect → **SSRF** (self/external/IMDS) → stack/echo → slow → unauth theft → enum → settings → **prototype pollution** → raw TCP (skip HTTPS) → login/BOLA/forge (skipped this run after pollution brick)

---

## 6. Compare to previous study (2026-07-31)

| | Prior engagement | This engagement (2026-08-01) |
| --- | --- | --- |
| Critical | 9 | **4** |
| Forged admin | YES | **no** (post-pollution login skip) |
| Prototype pollution phase | not present | present → **Workers 1101** |
| CORS / IMDS class | partial | **yes** |
| Reset cleanup field | no | **yes** |

The drop in critical count is **not** “CF is safer for the JWT thesis.” Unauth dump + secret leak still land. The climax was interrupted by the pollution/Workers interaction. Use Vercel or local for the full chain; use CF for edge notes + unauth pwn + “pollution can brick the isolate.”
