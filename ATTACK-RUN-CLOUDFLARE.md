# Attack run study — Cloudflare Workers (Express 5)

**Target:** `https://vaultpay-api.devlinduldulao.workers.dev`  
**Stack under test:** **Express 5** + JWT (intentionally vulnerable VaultPay demo)  
**Health proof:** `GET /api/health` → `"express":"5"`  
**Attack started:** 2026-07-31T17:50:28Z  
**Command:**

```powershell
# From this repo root
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama
```

**Result:** `DEMO RESULT: API PWNED — 9 critical findings · 68 requests`  
**By severity:** `CRITICAL: 9` · `HIGH: 5` · `MEDIUM: 4`

This document studies **only Express 5** on **Cloudflare Workers**.  
Sister study (same app on Vercel): [`ATTACK-RUN-VERCEL.md`](ATTACK-RUN-VERCEL.md) · comparison: [`PLATFORM-COMPARISON.md`](PLATFORM-COMPARISON.md).

---

## 1. Bottom line

| Question | Answer |
| --- | --- |
| Is production Express 5? | **Yes.** Live health returns `"express":"5"`. Banner says `Express 5 target`. |
| Did JWT make the API “secure”? | **No.** Most damage needed **no password**. |
| Did the demo work? | **Yes.** PII dump, secret theft, BOLA, mass assignment, forged admin. |
| What underperformed? | **Cloudflare platform** blocked two probes (SSRF self-fetch `1042`, XSS WAF `403`). Not Express learning security. |

**Talk sound bite:**

> “This is Express 5 on Cloudflare with JWT. Without logging in we stole every card number and the signing secret. Then we forged an admin token. Authn is not authz.”

---

## 2. Scoreboard

| Metric | Value |
| --- | --- |
| HTTP requests | 68 |
| Findings recorded | 18 |
| Users stolen (seed) | 4 |
| Orders stolen | 5 |
| JWT secret | `supersecret123` |
| Privilege escalation | YES |
| Forged admin | YES |

### All findings (as printed)

| # | Severity | Title |
| --- | --- | --- |
| 1 | MEDIUM | No secure response headers |
| 2 | HIGH | Oversized JSON body accepted (no tight bodyLimit) |
| 3 | HIGH | No rate limiting on authentication |
| 4 | CRITICAL | Path traversal reads server secret files |
| 5 | HIGH | Open redirect |
| 6 | MEDIUM | Production-style stack traces exposed |
| 7 | MEDIUM | No requestTimeoutMs — slow handlers hold sockets |
| 8 | CRITICAL | Unauthenticated user dump |
| 9 | CRITICAL | IDOR on `/api/users/:id` without auth |
| 10 | CRITICAL | Debug endpoint leaks JWT signing secret |
| 11 | HIGH | Unauthenticated PII search |
| 12 | MEDIUM | Login error messages enable account enumeration |
| 13 | CRITICAL | BOLA on `/api/orders` |
| 14 | CRITICAL | Mass assignment privilege escalation |
| 15 | CRITICAL | Cross-user write without ownership check |
| 16 | CRITICAL | Admin route checks login only, not role |
| 17 | CRITICAL | Forged JWTs accepted (weak/leaked secret) |
| 18 | HIGH | Unauthenticated settings write with mass assignment |

**Not recorded as findings (platform interference):**

- Phase 07 SSRF self-proxy (CF `error code: 1042`)
- Phase 08 XSS HTML echo (CF **403**; script printed `DEFENDED / OK` — misleading)

---

## 3. How to read the console

```text
WHY      why this phase matters (often vs Daloy defaults)
»        narration — what we are about to send
→ SEND   request: method, path, auth, body size
← RECV   response: status, latency, size
✗ / ✓    verdict for this probe
LOOT     stolen or sensitive material
[SEV]    finding added to the engagement report
scoreboard  running CRITICAL / HIGH / MEDIUM counts
```

`✓ DEFENDED / OK` sometimes means “this probe did not fire,” not “Express is secure” (especially the XSS 403).

---

## 4. Phase-by-phase (this run)

### Phase 01 — Recon

| | |
| --- | --- |
| `GET /api/health` | **200** in 142ms |
| Body | `{"ok":true,"service":"vaultpay-api","express":"5",...}` |
| `GET /` | Self-describes routes (login, users, files, proxy, go) |

**Note:** `NODE_TLS_REJECT_UNAUTHORIZED=0` warning means the attacker machine is behind TLS intercept (e.g. Zscaler). Demo laptop only.

**Takeaway:** Live target is Express 5; it advertises its own attack surface.

---

### Phase 02 — Missing security headers → **MEDIUM**

All missing:

- `x-content-type-options`
- `x-frame-options`
- `content-security-policy`
- `strict-transport-security`
- `referrer-policy`
- `permissions-policy`

**Daloy:** `secureHeaders` auto-install.  
**Express 5:** does not add these by default.

---

### Phase 03 — Oversized JSON body → **HIGH**

| | |
| --- | --- |
| Request | `POST /api/auth/login` body **1 572 908 B** (~1.5 MiB) |
| Response | **401** in 301ms — `No account for that email` |

Not **413**. The server accepted and processed the huge body, then rejected credentials.

**Daloy:** `bodyLimitBytes` 1 MiB → 413.

---

### Phase 04 — Login flood → **HIGH**

| | |
| --- | --- |
| Load | 40 parallel wrong passwords |
| Time | **341ms** |
| Histogram | `{"401":40}` — **zero 429** |

**Daloy:** `rateLimit` / `loginThrottle`.

---

### Phase 05 — Path traversal → **CRITICAL** ★

| | |
| --- | --- |
| Legit | `GET /api/files?name=welcome.txt` → 200 (expected) |
| Attack | `GET /api/files?name=../secrets/jwt-backup.txt` → **200** |
| LOOT | `JWT_SECRET=supersecret123`, recovery code, fake DB string |

No auth. Escapes “public” into secrets via `../`.

---

### Phase 06 — Open redirect → **HIGH**

| | |
| --- | --- |
| Request | `GET /api/go?url=https://evil-phish.example/steal` |
| Response | **302** `Location: https://evil-phish.example/steal` |

**Daloy:** `safeRedirect` allowlist.

---

### Phase 07 — Open proxy / SSRF → **underperformed (Cloudflare)**

| | |
| --- | --- |
| Request | Proxy to own URL `…/api/debug/config` |
| Response | **404** body `error code: 1042` |
| Finding | None recorded |

**Honest narration:** Cloudflare blocked Worker self-fetch (1042). That is **platform**, not Express 5 fixing SSRF. The open-proxy route still exists; the JWT secret was still stolen in phases 05 and 10 without any proxy.

---

### Phase 08 — Stack leak + XSS → **mixed**

| Probe | Result | Finding |
| --- | --- | --- |
| `GET /api/boom` | **500** + stack (`worker.js:…`) | **MEDIUM** stack leak |
| XSS `msg=<img onerror=alert(1)>` | **403** ~14 KB body | Console: `✓ DEFENDED` — treat as **WAF block**, not app fix |

**Daloy:** prod problem+json redaction; no raw HTML echo.

---

### Phase 09 — Slow handler → **MEDIUM**

| | |
| --- | --- |
| Request | `GET /api/slow?ms=3000` |
| Result | **200** after **3029ms** |

No server-side request timeout budget.

**Daloy:** `requestTimeoutMs` default 30s.

---

### Phase 10 — Unauthenticated data theft → **main scare** ★

| Request | Result |
| --- | --- |
| `GET /api/users` no auth | **200** — 4 accounts, SSN + full card + CVV |
| `GET /api/users/1` no auth | Alice PII + internal note |
| `GET /api/debug/config` | `jwtSecret`, feature flags all false |
| `GET /api/search?q=oslo` | Alice + Bob addresses + SSNs → **HIGH** |

Scoreboard after this block: **4 critical** (plus prior highs/mediums), secret already YES from traversal.

---

### Phase 11 — Account enumeration → **MEDIUM**

| Case | Error string |
| --- | --- |
| Missing email | `No account for that email` |
| Wrong password | `Incorrect password` |

Different messages → free user discovery.

---

### Phase 12 — Login, BOLA, mass assignment, admin, forge → **CRITICAL chain** ★

| Step | What happened |
| --- | --- |
| Login Alice | **200** + JWT (the “we’re secured” moment) |
| `GET /api/orders` with Alice JWT | **5 orders / 4 users**, including payroll **$50 000** → BOLA |
| Register disposable attacker | New user id so seed demo accounts stay usable for re-runs |
| `PUT` `role: "admin"`, `balance: 1000000` | Mass assignment → **CRITICAL** |
| `PUT` another user id as attacker | Cross-user write → **CRITICAL** |
| `GET /api/admin/stats` | Plaintext **passwords** for all accounts → **CRITICAL** |
| Forge HS256 admin JWT with `supersecret123` | `/api/me` accepts as VaultPay Admin → **CRITICAL** |

**Talk line:** JWT answered “who?”. Nothing asked “allowed?”. Then we did not even need their password.

---

### Phase 13 — Unauth settings write → **HIGH**

`PUT /api/settings` without token set `theme=pwned`, `injected=true`. Script restored settings afterward.

---

### Phase 14 — Raw TCP → skipped

HTTPS target → raw socket probes skipped (expected).

---

## 5. Demo expectations vs this Express 5 run

| Expectation | Met? | Notes |
| --- | --- | --- |
| Express 5 in production | Yes | Health `"express":"5"` |
| JWT alone insufficient | Yes | Phases 10–12 |
| Steal PII without login | Yes | Phase 10 |
| Steal JWT secret | Yes | Path traversal + debug |
| Priv-esc + forge admin | Yes | Phase 12 |
| SSRF self-proxy CRITICAL | No | CF **1042** |
| XSS sink HIGH | No | CF WAF **403** |
| Rate limit absence | Yes | 40× 401, 0× 429 |
| Body limit absence | Yes | 1.5 MiB → 401 not 413 |
| Open redirect | Yes | 302 to evil host |

**Overall grade: success** for the teaching story. Be honest on stage about the two Cloudflare platform blocks.

---

## 6. Environment notes (attacker laptop)

| Issue | Detail |
| --- | --- |
| TLS warning | `NODE_TLS_REJECT_UNAUTHORIZED=0` — corporate MITM (e.g. Zscaler). Node lacks the org CA. |
| When to set it | Only if `fetch failed` / `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` |
| Clean network | Leave the variable unset |

```powershell
# Only if needed
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama
```

---

## 7. Script labeling issues (cosmetic)

| Issue | Evidence | Ideal improvement |
| --- | --- | --- |
| SSRF silent on 1042 | Only `· Proxy probe → 404` | Fallback external open-proxy; record INFO/HIGH |
| XSS marked DEFENDED on 403 | `✓ DEFENDED / OK` | Label **PLATFORM BLOCKED** |
| Flood request IDs jump | `#4` → `#45` | Print collapsed range |

These do not undo the nine critical findings.

---

## 8. What to fix in a real product

| Hole seen live | Real fix |
| --- | --- |
| Public users / IDOR | Auth + ownership checks |
| Debug secret public | Remove in prod; never echo secrets |
| Path traversal files | Contain paths; or do not take user file paths |
| BOLA orders | Filter by `req.user.sub` (or admin role) |
| Mass assignment | Allowlist fields; never trust client `role` |
| Admin without role check | `requireRole("admin")` |
| Weak JWT secret | Long random secret or asymmetric keys |
| No rate limit | Login throttle + IP limits |
| Huge body | Hard body cap (e.g. 1 MiB) |
| Open redirect | Allowlist destinations |
| Open proxy | No arbitrary server-side fetch; SSRF-safe defaults |
| Stacks in JSON | Prod redaction |
| HTML echo | Encode; do not serve user input as HTML |
| Login enum | One generic error message |
| Missing headers | Secure header middleware |

**DaloyJS angle:** many transport defaults (body limit, rate limit, headers, safe redirect, SSRF guard, redaction) ship closed-by-default. Ownership rules remain application code — but you do not start from bare Express 5 with JWT on one route.

---

## 9. Five-minute talk path

1. Browser or curl: `GET /api/health` → `"express":"5"`. “Express 5 + JWT API, public.”  
2. Phase 10 LOOT — cards and SSNs, no token.  
3. Path traversal → `supersecret123`.  
4. Phase 12: BOLA payroll → mass-assign admin → forge admin JWT.  
5. 15s honesty: “Express 5 on Cloudflare. WAF blocked XSS; CF blocked self-SSRF. The database still emptied.”  
6. Close: Authn ≠ authz; defaults matter.

---

## 10. Reproduce

Repo lives next to `daloy`:

```text
Documents/GitHub/daloy/
Documents/GitHub/demo-attack-express/   ← this project
```

From **this** repo root:

```powershell
# Optional: redeploy Express 5 API
cd server
npm install
npx wrangler deploy
cd ..

# Confirm
Invoke-RestMethod https://vaultpay-api.devlinduldulao.workers.dev/api/health
# expect: express = 5

# Attack (Zscaler only if cert errors)
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama
```

From **daloy** workspace:

```powershell
cd ../demo-attack-express
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama
```

Full env/runbook: [`HOW-TO-ATTACK.md`](HOW-TO-ATTACK.md).  
**Projector slide (Cloudflare edge vs app):** [`CLOUDFLARE-VS-APP-SECURITY.md`](CLOUDFLARE-VS-APP-SECURITY.md).

---

## 11. Cheat sheet ★

```text
EXPRESS 5 ON CLOUDFLARE — this engagement only

NO LOGIN
  missing headers              MEDIUM
  1.5MB body accepted          HIGH
  40 logins, no 429            HIGH
  ../secrets → JWT secret      CRITICAL  ★
  open redirect                HIGH
  self-SSRF                    CF 1042 (platform)
  stack traces                 MEDIUM
  XSS probe                    CF 403 (platform)
  slow handler ~3s             MEDIUM
  GET /api/users dump          CRITICAL  ★
  GET /api/users/1 IDOR        CRITICAL  ★
  GET /api/debug/config        CRITICAL  ★
  GET /api/search PII          HIGH
  login error enumeration      MEDIUM
  PUT /api/settings            HIGH

ANY USER JWT
  all orders (BOLA)            CRITICAL  ★
  mass assign admin            CRITICAL  ★
  write other user             CRITICAL  ★
  GET /api/admin/stats         CRITICAL  ★

LEAKED SECRET
  forge admin JWT              CRITICAL  ★

★ = show on projector if short on time
Express 5 = current framework; JWT alone still fails closed-authz
```

---

*Educational VaultPay demo only. Express 5 target on Cloudflare Workers. Do not attack systems you do not own.*
