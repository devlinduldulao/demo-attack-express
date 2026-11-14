# Attack run study — Vercel (Express 5)

> Fresh capture, 2026-11-14 (UTC), with the current attack scripts. It replaces
> the 2026-08-01 study, whose titles and totals predated the evidence audit.
> Severities are demo-author ratings, not CVSS. Counts are finding records, not
> unique root causes.

**Target:** `https://vaultpay-api.vercel.app`
**Stack:** **Express 5** + JWT (intentionally vulnerable VaultPay)
**Health:** `{"ok":true,"service":"vaultpay-api","express":"5"}`
**Debug config:** `env=production`, `runtime=vercel-serverless`, `bodyLimit=50mb`
**Deployed code:** whatever was live on the day. The project was **not**
redeployed for this capture.
**TLS bypass:** not needed on this network.

Two runs, one per script:

```bash
node --no-warnings attack/attack.mjs   https://vaultpay-api.vercel.app --projector --reset --json
node --no-warnings attack/attackv2.mjs https://vaultpay-api.vercel.app --projector --reset --json
# stage pacing: add --drama
```

| | Full run (`attack.mjs`) | Short edition (`attackv2.mjs`) |
| --- | --- | --- |
| Result line | `API PWNED — 10 critical findings · 71 requests · 9.1s` | `API PWNED — 9 critical findings · 56 requests · 3.1s` |
| Finding records | 22 | 11 |
| By severity | CRITICAL 10 · HIGH 6 · MEDIUM 3 · INFO 3 | CRITICAL 9 · HIGH 2 |
| By kind | app-code 15 · framework-gap 4 · misconfig 3 | app-code 10 · framework-gap 1 |
| OWASP API 2023 | API1, API2, API3, API4, API5, API7, API8 | API1, API2, API3, API5, API7 |
| Loot | 4 users · 5 orders · JWT secret · privilege escalation · forged admin | same |
| `◇ PLATFORM` notes | 1 (`alg:none` denied at the edge) | 1 (same) |
| Blocked / reduced probes | not tallied by this script | 0 / 0 |

Cloudflare sister: [`ATTACK-RUN-CLOUDFLARE.md`](ATTACK-RUN-CLOUDFLARE.md) ·
[`PLATFORM-COMPARISON.md`](PLATFORM-COMPARISON.md) · talk script: [`TALK.md`](TALK.md)

---

## 1. Bottom line

| Question | Answer |
| --- | --- |
| Unauthenticated user dump, IDOR, PII search? | **Works.** SSN, card number and CVV for all four users with no token. |
| Path traversal to the signing secret? | **Works.** `../secrets/jwt-backup.txt` returns `JWT_SECRET=supersecret123`. |
| Self-SSRF through `/api/proxy`? | **Works** (unlike Cloudflare). The server fetched its own debug config and returned the secret. |
| BOLA, admin route, cross-user write, mass assignment? | **Works.** One ordinary login as Alice. |
| Forged admin JWT? | **Works.** The server returns the admin identity for an attacker-signed token. |
| `alg:none`? | **Denied by Vercel's firewall** (`403`, `x-vercel-mitigated: deny`). The app never saw the request. |
| Cloud metadata URL? | `502`, no metadata content. No finding recorded. |
| Login flood? | 40 of 40 wrong passwords answered normally, zero `429`. |

This is the full chain on a public free-tier host.

---

## 2. Full run — findings (22)

### CRITICAL (10)

| Finding | kind | Tag |
| --- | --- | --- |
| Path traversal exposes virtual secret-file contents | app-code | CWE-22 |
| SSRF proxy returns its public debug endpoint's secret | app-code | API7 |
| Unauthenticated user dump | app-code | API5 |
| IDOR on `/api/users/:id` without auth | app-code | API1 |
| Debug endpoint leaks JWT signing secret | app-code | API8 |
| BOLA on `/api/orders` | app-code | API1 |
| Admin route accessible to a non-admin identity | app-code | API5 |
| Cross-user write without ownership check | app-code | API1 |
| Mass assignment privilege escalation | app-code | API3 |
| Forged JWTs accepted (weak/leaked secret) | app-code | API2 |

The SSRF finding is the one extra critical compared with Cloudflare. It proves
the proxy returned the secret from the app's own public URL; it does not prove
access to an internal-only network.

### HIGH (6)

| Finding | kind | Tag | Notes |
| --- | --- | --- | --- |
| Login accepts approximately 1.5 MiB JSON body | misconfig | API4 | HTTP 401 after parsing, in 878 ms |
| No authentication throttling observed in this batch | framework-gap | API2 | 40 × 401, zero 429 |
| Open redirect | app-code | CWE-601 | |
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

Five of the six audited browser headers were missing. `strict-transport-security`
was present (`max-age=63072000; includeSubDomains; preload`), added by Vercel.

---

## 3. Short edition — findings (11)

| Phase | Finding | Severity |
| --- | --- | --- |
| 02 Data theft | Unauthenticated user dump | CRITICAL |
| 02 | IDOR on `/api/users/:id` without auth | CRITICAL |
| 02 | Unauthenticated PII search | HIGH |
| 03 Path traversal | Path traversal exposes virtual secret-file contents | CRITICAL |
| 04 SSRF | SSRF proxy returns its public debug endpoint's secret | CRITICAL |
| 05 Authn ≠ authz | BOLA on `/api/orders` | CRITICAL |
| 05 | Admin route accessible to a non-admin identity | CRITICAL |
| 05 | Cross-user write without ownership check | CRITICAL |
| 05 | Mass assignment privilege escalation | CRITICAL |
| 06 Login flood | No authentication throttling observed in this batch | HIGH |
| 07 Forge | Forged JWTs accepted (weak/leaked secret) | CRITICAL |

On this host the short edition matches a laptop run finding for finding, so it
is the better deployed target if you want phase 04 to show the secret.

---

## 4. Misconfig (3) — whose fault on this Vercel deploy?

Identical to Cloudflare. These are **not** Vercel defaults and **not** Express defaults.

| Finding | Severity | Not whose fault | Is whose fault | Shipped how |
| --- | --- | --- | --- | --- |
| Health response permits cross-origin reads | INFO | Vercel edge, bare Express | Demo app | `cors({ origin: "*" })` in `server/app.js` |
| Login accepts approximately 1.5 MiB JSON body | HIGH | Vercel, Express `json()` 100kb | Demo app + env | `BODY_LIMIT=50mb` + `jsonBody` |
| Custom handler exposes stack trace | MEDIUM | Express `finalhandler` when `NODE_ENV=production` | Demo app | `/api/boom` + error middleware return `stack` |

See also: [`CLOUDFLARE-VS-APP-SECURITY.md`](CLOUDFLARE-VS-APP-SECURITY.md#whose-fault-cloud-deploy-honesty).

---

## 5. Platform notes (this capture)

| Probe | Vercel result |
| --- | --- |
| `alg:none` token on `/api/me` | **403 from the firewall**, `x-vercel-mitigated: deny`. Reproduced three times by hand. A malformed but ordinary token (`abc.def.ghi`) reached the app and got its `401`. |
| Self `/api/proxy` → own debug config | Works (**CRITICAL**) |
| Metadata URL `169.254.169.254` | `502`, no metadata content, no finding |
| HSTS | Present, added by the platform |
| Raw TCP probes | Skipped (HTTPS target) |
| Internal pivot (`--internal`) | Not used |
| `--reset` | One reset was enough in both runs; no tampered data seen afterwards |

### The `alg:none` denial is new

The 2026-08-01 capture recorded `alg:none` as rejected with `401` by
`jsonwebtoken`. On 2026-11-14 the request no longer reaches the app. Both
attack scripts now print this as `◇ PLATFORM` instead of crediting the JWT
library, because the app's own answer to an unsigned token is untested on this
host.

It is the same lesson as Cloudflare's error 1042, with the roles swapped: the
edge stopped one noisy probe, and the forged admin token signed with the leaked
secret went straight through.

---

## 6. Talk takeaway

Vercel's edge added HSTS and denied one unsigned-token request. It did not stop
the card dump, the secret leak, the self-SSRF, BOLA, mass assignment or the
forged admin token. **Edge ≠ API authorization.**
