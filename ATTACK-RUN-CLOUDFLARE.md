# Attack run study — Cloudflare Workers (Express 5)

> Fresh capture, 2026-11-14 (UTC), with the current attack scripts. It replaces
> the 2026-08-01 study, whose titles and totals predated the evidence audit.
> Severities are demo-author ratings, not CVSS. Counts are finding records, not
> unique root causes.

**Target:** `https://vaultpay-api.devlinduldulao.workers.dev`
**Stack:** **Express 5** + JWT (intentionally vulnerable VaultPay)
**Health:** `{"ok":true,"service":"vaultpay-api","express":"5"}`
**Debug config:** `env=production`, `runtime=cloudflare-workers`, `bodyLimit=50mb`
**Deployed code:** whatever was live on the day. The Worker was **not** redeployed
for this capture and its version ID was not re-checked.
**TLS bypass:** not needed on this network.

Two runs, one per script:

```bash
node --no-warnings attack/attackv2.mjs https://vaultpay-api.devlinduldulao.workers.dev --projector --reset
node --no-warnings attack/attack.mjs   https://vaultpay-api.devlinduldulao.workers.dev --projector --reset --json
# stage pacing: add --drama
```

| | Short edition (`attackv2.mjs`) | Full run (`attack.mjs`) |
| --- | --- | --- |
| Result line | `API PWNED — 8 critical findings · 57 requests · 0.7s` | `API PWNED — 9 critical findings · 71 requests · 4.1s` |
| Finding records | 11 | 22 |
| By severity | CRITICAL 8 · HIGH 3 | CRITICAL 9 · HIGH 7 · MEDIUM 3 · INFO 3 |
| By kind | app-code 10 · framework-gap 1 | app-code 15 · framework-gap 4 · misconfig 3 |
| OWASP API 2023 | API1, API2, API3, API5, API7 | API1, API2, API3, API4, API5, API7, API8 |
| Loot | 4 users · 5 orders · JWT secret · privilege escalation · forged admin | same |
| `◇ PLATFORM` notes | 1 (error 1042) | 1 (error 1042) |
| Blocked / reduced probes | 0 / 0 | not tallied by this script |

The full run was captured just before the reset check described in section 5 was
added; the current script sends at least one more request.

Sister study: [`ATTACK-RUN-VERCEL.md`](ATTACK-RUN-VERCEL.md) (captured the same day) ·
[`PLATFORM-COMPARISON.md`](PLATFORM-COMPARISON.md) · talk script: [`TALK.md`](TALK.md)

---

## 1. Bottom line

| Question | Answer |
| --- | --- |
| Unauthenticated user dump, IDOR, PII search? | **Works.** SSN, card number and CVV for all four users with no token. |
| Path traversal to the signing secret? | **Works.** `../secrets/jwt-backup.txt` returns `JWT_SECRET=supersecret123`. |
| BOLA, admin route, cross-user write, mass assignment? | **Works.** One ordinary login as Alice. |
| Forged admin JWT? | **Works.** The server returns the admin identity for an attacker-signed token. |
| `alg:none`? | Rejected (401) by `jsonwebtoken` v9, not by the app. |
| Self-SSRF through `/api/proxy`? | **Blocked by Cloudflare** (error 1042). The proxy still fetched `https://example.com/`. |
| Cloud metadata URL? | `403`, no metadata content. No finding recorded. |
| Login flood? | 40 of 40 wrong passwords answered normally, zero `429`, in 318 ms. |

Cloudflare changed the outcome of one probe out of the whole run. That is the
only difference from a local run: local scores 9 critical on the short edition,
because the self-fetch succeeds there.

---

## 2. Full run — findings (22)

### CRITICAL (9)

| Finding | kind | Tag |
| --- | --- | --- |
| Path traversal exposes virtual secret-file contents | app-code | CWE-22 |
| Unauthenticated user dump | app-code | API5 |
| IDOR on `/api/users/:id` without auth | app-code | API1 |
| Debug endpoint leaks JWT signing secret | app-code | API8 |
| BOLA on `/api/orders` | app-code | API1 |
| Admin route accessible to a non-admin identity | app-code | API5 |
| Cross-user write without ownership check | app-code | API1 |
| Mass assignment privilege escalation | app-code | API3 |
| Forged JWTs accepted (weak/leaked secret) | app-code | API2 |

### HIGH (7)

| Finding | kind | Tag | Notes |
| --- | --- | --- | --- |
| Login accepts approximately 1.5 MiB JSON body | misconfig | API4 | HTTP 401 after parsing, in 106 ms |
| No authentication throttling observed in this batch | framework-gap | API2 | 40 × 401, zero 429 |
| Open redirect | app-code | CWE-601 | `Location: https://evil-phish.example/steal` |
| Open proxy: server fetches arbitrary URLs (SSRF surface) | app-code | API7 | after the 1042 self-block |
| App code: reflected HTML echo sink (XSS class) | app-code | CWE-79 | |
| Unauthenticated PII search | app-code | API3 | |
| Unauthenticated settings write accepts arbitrary properties | app-code | API5 | |

### MEDIUM (3) and INFO (3)

| Finding | Severity | kind | Tag |
| --- | --- | --- | --- |
| Custom handler exposes stack trace | MEDIUM | misconfig | API8 |
| Client-selected delay holds a request for approximately 3 seconds | MEDIUM | framework-gap | API4 |
| Login error messages enable account enumeration | MEDIUM | app-code | API2 |
| `X-Powered-By: Express` left enabled | INFO | framework-gap | — |
| Security headers missing on health response | INFO | framework-gap | API8 |
| Health response permits cross-origin reads | INFO | misconfig | API8 |

All six audited browser headers were missing on the health response, including
`strict-transport-security`.

---

## 3. Short edition — findings (11)

| Phase | Finding | Severity |
| --- | --- | --- |
| 02 Data theft | Unauthenticated user dump | CRITICAL |
| 02 | IDOR on `/api/users/:id` without auth | CRITICAL |
| 02 | Unauthenticated PII search | HIGH |
| 03 Path traversal | Path traversal exposes virtual secret-file contents | CRITICAL |
| 04 SSRF | Open proxy: server fetches arbitrary URLs (SSRF surface) | HIGH |
| 05 Authn ≠ authz | BOLA on `/api/orders` | CRITICAL |
| 05 | Admin route accessible to a non-admin identity | CRITICAL |
| 05 | Cross-user write without ownership check | CRITICAL |
| 05 | Mass assignment privilege escalation | CRITICAL |
| 06 Login flood | No authentication throttling observed in this batch | HIGH |
| 07 Forge | Forged JWTs accepted (weak/leaked secret) | CRITICAL |

Phase 04 is the weak beat on this host: the screen shows a `◇ PLATFORM` line and
then a fetch of `example.com`, not the signing secret. On a laptop target the
same phase shows the secret a second time.

---

## 4. Misconfig (3) — whose fault on this Cloudflare deploy?

These lines carry `(misconfig)` in the full run. They are **not** Cloudflare
defaults and **not** Express defaults.

| Finding | Severity | Not whose fault | Is whose fault | Shipped how |
| --- | --- | --- | --- | --- |
| Health response permits cross-origin reads | INFO | CF edge, bare Express | Demo app | `cors({ origin: "*" })` in `server/app.js` |
| Login accepts approximately 1.5 MiB JSON body | HIGH | CF edge, Express `json()` 100kb | Demo app + vars | `BODY_LIMIT = "50mb"` in `wrangler.toml` + `jsonBody` |
| Custom handler exposes stack trace | MEDIUM | Express `finalhandler` when `NODE_ENV=production` | Demo app | `/api/boom` + error middleware return `stack` |

`◇ PLATFORM` (error **1042**) is the only "Cloudflare did something" line in
either run. It does not fix authorization or any of the three misconfigs.

See also: [`CLOUDFLARE-VS-APP-SECURITY.md`](CLOUDFLARE-VS-APP-SECURITY.md#whose-fault-cloud-deploy-honesty).

---

## 5. Platform notes (this capture)

| Probe | Cloudflare result |
| --- | --- |
| Self `/api/proxy` → own debug config | **1042** — edge/runtime, not app authorization |
| External open proxy (`example.com`) | Still works (**HIGH**) |
| Metadata URL `169.254.169.254` | `403`, no metadata content, no finding |
| Raw TCP probes | Skipped (HTTPS target) |
| Internal pivot (`--internal`) | Not used; the Worker cannot reach a laptop |

### Warm instances and `--reset`

The in-memory demo data lives per Worker instance. After these two runs a single
`POST /api/demo/reset` returned `ok`, yet the next read of user #2 still said
`Hijacked Bob`: the reset and the read were served by different instances. Eight
resets in a row left twelve consecutive reads clean.

Both attack scripts now check for this. After `--reset` they read `/api/users`
and repeat the reset (up to eight times) while a seed user still looks tampered
with. If you see `extra reset(s) for other warm instances` in phase 01, that is
this.

---

## 6. Talk takeaway

Cloudflare's edge blocked one self-fetch. It did not stop the card dump, the
secret leak, BOLA, mass assignment or the forged admin token.
**Edge ≠ API authorization.**

For the framework side of the same argument (the same app rebuilt on DaloyJS,
attacked with the same script) see [`server-daloy/README.md`](server-daloy/README.md)
or run `npm run compare`. That comparison is laptop-only; nothing DaloyJS is
deployed to Cloudflare.
