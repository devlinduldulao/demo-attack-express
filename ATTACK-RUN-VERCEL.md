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
Re-captured after **Whose fault?** report landed in `attack/attack.mjs` — search the log for `Whose fault?` / `Misconfig detail` (same three misconfigs as CF).  
Cloudflare sister: [`ATTACK-RUN-CLOUDFLARE.md`](ATTACK-RUN-CLOUDFLARE.md) · talk script: [`TALK.md`](TALK.md#terminal-whose-fault-on-cloud-runs)

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

## 4. Misconfig (3) — whose fault on this Vercel deploy?

Same three findings as Cloudflare (identical `app.js`). **Not** Vercel inventing open CORS or 50mb bodies.

| Finding | Severity | Terminal kind | Not whose fault | Is whose fault | Shipped how |
| --- | --- | --- | --- | --- | --- |
| CORS misconfig allows any browser origin | HIGH | `misconfig` | Vercel edge, bare Express | Demo app | `cors({ origin: "*" })` in `server/app.js` |
| Demo misconfig: custom ~50mb bodies | HIGH | `misconfig` | Vercel edge, Express `json()` 100kb | Demo app + env | `BODY_LIMIT` default/`vercel env` + `jsonBody` |
| Custom error handler leaks stack | MEDIUM | `misconfig` | Express `finalhandler` when `NODE_ENV=production` | Demo app | `/api/boom` + error middleware return `stack` |

**Attack phases** (identical to CF): CORS probe → oversized login body → `/api/boom` stack.  
JSON proof: `--json` then grep `"kind": "misconfig"` — three titles, same as Cloudflare.

### Terminal excerpt (committed proof — from live Vercel run)

Full wire log is gitignored (`ATTACK-RUN-VERCEL-LATEST.log`). Engagement report after the run (same misconfig story as CF):

```text
  By kind         {"framework-gap":4,"misconfig":3,"app-code":16}

  Whose fault? (read the kind tag on every finding):
    (misconfig)     3 — this demo's app/deploy vars (CORS *, BODY_LIMIT ~50mb, stack leak).
                     Not Express defaults. Not Cloudflare/Vercel inventing them.
    (framework-gap) 4 — Express does not ship the control ...
    (app-code)     16 — vulnerable routes you wrote ...

  Misconfig detail (cloud hosts still show these — same app.js):
  [HIGH] [API8] (misconfig) CORS misconfig allows any browser origin
  [HIGH] [API4] (misconfig) Demo misconfig: custom parser allows ~50mb bodies
  [MEDIUM] [API8] (misconfig) Misconfig: custom error handler leaks stack in production

  DEMO RESULT: API PWNED — 10 critical findings · 70 requests · 10.2s
```

Vercel may add **HSTS** at the edge. That does **not** clear the three misconfigs.  
(+1 critical vs CF is self-SSRF secret — **app-code**, not misconfig.)

See also: [`CLOUDFLARE-VS-APP-SECURITY.md`](CLOUDFLARE-VS-APP-SECURITY.md#whose-fault-cloud-deploy-honesty) · sister: [`ATTACK-RUN-CLOUDFLARE.md`](ATTACK-RUN-CLOUDFLARE.md) · talk: [`TALK.md`](TALK.md#terminal-whose-fault-on-cloud-runs).

---

## 5. Edge / platform (this run)

| Probe | Vercel |
| --- | --- |
| Self-proxy → `/api/debug/config` | **200** + `jwtSecret` |
| IMDS `169.254.169.254` | no real IMDS · platform note |
| HSTS | often present on edge; app still missing CSP/XFO/nosniff |

---

## 6. Compare to Cloudflare (same attacker, same day)

| | Cloudflare | Vercel |
| --- | --- | --- |
| Critical | **9** | **10** |
| Requests / time | 71 · 4.3s | 70 · 10.1s |
| Forged admin | YES | YES |
| Self-SSRF secret | No (1042) | **YES** |

---

## 7. Talk takeaway

Same incomplete Express + JWT app. Vercel adds the self-SSRF secret path; both still dump PII and accept a forged admin JWT. **Hosting platform ≠ API security.**  
`(misconfig)` on this Vercel URL is the **demo’s CORS / BODY_LIMIT / stack handler** — not “serverless defaults are open CORS” and not Express’s 100kb body default.
