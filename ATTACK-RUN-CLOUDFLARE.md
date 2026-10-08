# Attack run study — Cloudflare Workers (Express 5)

> Historical capture (2026-08-01), not current expected output. The later evidence
> audit corrected traversal to CWE-22, redirect to CWE-601, HTML sink to CWE-79,
> collection/settings access to API5, and authentication throttling to API2.
> CORS/headers are posture observations; failed metadata probes are not findings.
> Old severity totals and titles below are preserved as history, not endorsed as
> current classifications. Re-run to obtain current evidence and counts; see README.md.

**Target:** `https://vaultpay-api.devlinduldulao.workers.dev`  
**Stack:** **Express 5** + JWT (intentionally vulnerable VaultPay)  
**Deployed:** 2026-08-01 — local `wrangler deploy`  
**Worker Version ID:** `46b0d6b3-8d54-4217-8eac-c9c28dffbe09`  
**Health:** `{"ok":true,"service":"vaultpay-api","express":"5"}`  
**Attack:** 2026-08-01 · `node --no-warnings attack/attack.mjs URL --reset --json`  
(no `--internal`; no prototype-pollution phase in current attacker)

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"   # Zscaler only if needed
node --no-warnings attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --reset --json
# stage pacing:
node --no-warnings attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama --reset
```

**Result:** `DEMO RESULT: API PWNED — 9 critical findings · 71 requests · 4.3s`  
**By severity:** `CRITICAL: 9` · `HIGH: 9` · `MEDIUM: 4` · `INFO: 1` (**23** findings)  
**By kind:** `app-code: 16` · `framework-gap: 4` · `misconfig: 3`  
**OWASP API:** API1, API2, API3, API4, API5, API7, API8  
**Loot:** 4 users · JWT secret **YES** · privilege esc **YES** · forged admin **YES**  
**`alg:none`:** rejected (401) — jsonwebtoken v9 defaults to HS256/384/512 for string secrets

Raw log (local, gitignored): `ATTACK-RUN-CLOUDFLARE-LATEST.log`  
Re-captured after **Whose fault?** report landed in `attack/attack.mjs` — search the log for `Whose fault?` / `Misconfig detail`.  
Sister study: [`ATTACK-RUN-VERCEL.md`](ATTACK-RUN-VERCEL.md) · [`PLATFORM-COMPARISON.md`](PLATFORM-COMPARISON.md) · talk script: [`TALK.md`](TALK.md#terminal-whose-fault-on-cloud-runs)

---

## 1. Bottom line

| Question | Answer |
| --- | --- |
| Current code on CF? | **Yes** (version above) |
| Unauth PII (Personally Identifiable Information) (Personally Identifiable Information) / IDOR (Insecure Direct Object Reference) (Insecure Direct Object Reference) / secret / traversal? | **CRITICAL** |
| BOLA (Broken Object Level Authorization) (Broken Object Level Authorization) / mass-assign / BFLA (Broken Function Level Authorization) (Broken Function Level Authorization) / forge? | **CRITICAL** — full climax |
| Self-SSRF open proxy? | **Blocked** CF **1042** → external open proxy still **HIGH** |
| IMDS-class URL? | No real IMDS · **HIGH** no egress allowlist + `◇ PLATFORM` |
| CORS `*`? | **HIGH** misconfig |

---

## 2. CRITICAL (9)

| Finding | kind | OWASP |
| --- | --- | --- |
| Path traversal reads server secret files | app-code | API1 |
| Unauthenticated user dump | app-code | API1 |
| IDOR (Insecure Direct Object Reference) (Insecure Direct Object Reference) on `/api/users/:id` without auth | app-code | API1 |
| Debug endpoint leaks JWT signing secret | app-code | API8 |
| BOLA (Broken Object Level Authorization) (Broken Object Level Authorization) on `/api/orders` | app-code | API1 |
| Mass assignment privilege escalation | app-code | API3 |
| Cross-user write without ownership check | app-code | API1 |
| Admin route checks login only, not role | app-code | API5 |
| Forged JWTs accepted (weak/leaked secret) | app-code | API2 |

---

## 3. HIGH (9)

| Finding | kind | Notes |
| --- | --- | --- |
| CORS misconfig allows any browser origin | misconfig | `ACA-Origin: *` |
| Demo misconfig: custom ~50mb bodies | misconfig | not Express `json()` 100kb default |
| No rate limiting on authentication | framework-gap | 40×401, zero 429 |
| Open redirect | app-code | |
| Open proxy: arbitrary external URLs | app-code | after CF 1042 self-block |
| Open proxy no egress allowlist (IMDS-class) | app-code | app did not refuse link-local URL |
| HTML echo XSS class | app-code | |
| Unauthenticated PII (Personally Identifiable Information) (Personally Identifiable Information) search | app-code | |
| Unauthenticated settings write | app-code | |

**MEDIUM:** missing secure headers, stack leak misconfig, no app request timeout, login enumeration  
**INFO:** `X-Powered-By: Express`

---

## 4. Misconfig (3) — whose fault on this Cloudflare deploy?

These **HIGH/MEDIUM** lines appear on the Worker with `(misconfig)` in the terminal.  
They are **not** Cloudflare defaults and **not** Express inventing open CORS / huge bodies / prod stacks.

| Finding | Severity | Terminal kind | Not whose fault | Is whose fault | Shipped how |
| --- | --- | --- | --- | --- | --- |
| CORS misconfig allows any browser origin | HIGH | `misconfig` | CF edge, bare Express | Demo app | `cors({ origin: "*" })` in `server/app.js` |
| Demo misconfig: custom ~50mb bodies | HIGH | `misconfig` | CF edge, Express `json()` 100kb | Demo app + vars | `BODY_LIMIT = "50mb"` in `wrangler.toml` + `jsonBody` |
| Custom error handler leaks stack | MEDIUM | `misconfig` | Express `finalhandler` when `NODE_ENV=production` | Demo app | `/api/boom` + error middleware return `stack` |

**Attack phases that produce them** (same `attack/attack.mjs` on every host):

| Phase | Request | Finding |
| --- | --- | --- |
| CORS misconfig | `GET /api/health` + `Origin: https://evil-attacker.example` | open `ACA-Origin: *` |
| Oversized JSON body | `POST /api/auth/login` ~1.5 MiB body | accepted (not 413) |
| Stack / error path | `GET /api/boom` (and related error path) | `stack` in JSON |

### Terminal excerpt (committed proof — from live CF run)

Full wire log is gitignored (`ATTACK-RUN-CLOUDFLARE-LATEST.log`). This block is what the engagement report prints after the three misconfig phases (and the rest of the run):

```text
  PHASE 04  ·  CORS misconfig — any Origin allowed (no login)
  [HIGH] [API8] (misconfig) CORS misconfig allows any browser origin
  · cors package with origin: '*' — not an Express default (bare Express has no CORS)...

  PHASE 05  ·  Oversized JSON body (demo misconfig — not Express default)
  [HIGH] [API4] (misconfig) Demo misconfig: custom parser allows ~50mb bodies
  · Not an Express default. body-parser/express.json limit defaults to '100kb'...

  ... later ...
  [MEDIUM] [API8] (misconfig) Misconfig: custom error handler leaks stack in production

  By kind         {"framework-gap":4,"misconfig":3,"app-code":16}

  Whose fault? (read the kind tag on every finding):
    (misconfig)     3 — this demo's app/deploy vars (CORS *, BODY_LIMIT ~50mb, stack leak).
                     Not Express defaults. Not Cloudflare/Vercel inventing them.
    (framework-gap) 4 — Express does not ship the control ...
    (app-code)     16 — vulnerable routes you wrote ...
    ◇ PLATFORM      N — edge/runtime blocked a probe; does not mean the API is authorized.

  Misconfig detail (cloud hosts still show these — same app.js):
  [HIGH] [API8] (misconfig) CORS misconfig allows any browser origin
  [HIGH] [API4] (misconfig) Demo misconfig: custom parser allows ~50mb bodies
  [MEDIUM] [API8] (misconfig) Misconfig: custom error handler leaks stack in production
```

`◇ PLATFORM` (e.g. **1042**) is the only “Cloudflare did something” class in this study — and it does **not** fix authz or the three misconfigs above.

See also: [`CLOUDFLARE-VS-APP-SECURITY.md`](CLOUDFLARE-VS-APP-SECURITY.md#whose-fault-cloud-deploy-honesty) · talk: [`TALK.md`](TALK.md#terminal-whose-fault-on-cloud-runs).

---

## 5. Platform notes (this run)

| Probe | CF result |
| --- | --- |
| Self `/api/proxy` → debug | **1042** — edge/runtime, not app authz |
| External open proxy (`example.com`) | **HIGH** — still works |
| IMDS `169.254.169.254` | no IMDS data · `◇ PLATFORM` |
| Internal pivot (`--internal`) | not used (API cannot reach your laptop from CF) |

---

## 6. Phase order (current attacker)

Reset → recon → headers → CORS → body → flood → traversal → redirect → SSRF → stack/echo → slow → unauth theft → enum → settings → raw TCP (skip HTTPS) → **login / BOLA (Broken Object Level Authorization) (Broken Object Level Authorization) / mass-assign / admin / alg:none / forge**

With `--drama`, each phase waits for **Enter**.

---

## 7. Talk takeaway

Cloudflare free edge blocked **noisy self-SSRF** and has no real IMDS. It did **not** stop unauth card dump, secret leak, BOLA (Broken Object Level Authorization) (Broken Object Level Authorization), mass-assign, or forged admin. **Edge ≠ API authorization.**  
When the console shows `(misconfig)` for CORS / body / stack on this Worker URL, blame the **demo app and `BODY_LIMIT` in wrangler** — not Cloudflare and not Express’s real defaults.
