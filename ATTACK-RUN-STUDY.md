# Attack run study guide (Express 5 · live Cloudflare)

**Target:** `https://vaultpay-api.devlinduldulao.workers.dev`  
**Framework:** Express **5.2.1** (confirmed via `GET /api/health` → `"express":"5"`)  
**Deployed:** 2026-07-31 · Wrangler Version ID `3150c064-c3e6-43c1-9d39-0f63a472d53f`  
**Attack run:** 2026-07-31T17:36:00Z  
**Command:**

```bash
# On this Zscaler laptop Node needs TLS bypass (Windows cert store trusts Zscaler; Node does not)
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --json
```

**Result:** `API PWNED — 9 critical · 5 high · 4 medium · 68 requests`  
**Raw log:** [`ATTACK-RUN-LATEST.log`](ATTACK-RUN-LATEST.log)

---

## 1. Bottom line

| Question | Answer |
| --- | --- |
| Did Express 5 deploy to Workers? | **Yes.** Health returns `"express":"5"`. |
| Does Express 5 alone secure the API? | **No.** Same holes as before: unauth PII dump, path traversal secret, BOLA, mass assignment, forged JWT. |
| Did the demo scare still work? | **Yes.** 9 critical findings; cards, SSNs, passwords, JWT secret stolen. |
| Any probes weaker than local Node? | **Yes — platform, not Express.** SSRF self-fetch CF `1042`; XSS CF WAF `403`. |

**Talk sound bite:**

> “We upgraded to Express 5 and redeployed to Cloudflare. JWT still only protected a few routes. Without a password we dumped every card number and forged an admin token.”

---

## 2. Deploy record (what we did)

```text
cd demo-attack-express/server
npx wrangler whoami          # logged in as devlinduldulao@gmail.com
npm ls express               # express@5.2.1
npx wrangler deploy
# → https://vaultpay-api.devlinduldulao.workers.dev
# Upload ~770 KiB / gzip ~134 KiB · Worker startup ~54 ms
```

Smoke after deploy:

```json
{"ok":true,"service":"vaultpay-api","express":"5","time":"2026-07-31T17:35:48.444Z"}
```

---

## 3. Final scoreboard

| Severity | Count |
| --- | --- |
| CRITICAL | **9** |
| HIGH | **5** |
| MEDIUM | **4** |
| INFO | 0 |

| Loot summary | Value |
| --- | --- |
| Users stolen | 4 (+ 2 disposable during attack) |
| Orders stolen | 5 (all customers) |
| JWT secret | `supersecret123` |
| Privilege escalation | YES (mass-assign `role: admin`) |
| Forged admin JWT | YES (`admin@vaultpay.demo`) |

### All 18 findings (as recorded)

1. **MEDIUM** — No secure response headers  
2. **HIGH** — Oversized JSON body accepted (no tight bodyLimit)  
3. **HIGH** — No rate limiting on authentication  
4. **CRITICAL** — Path traversal reads server secret files  
5. **HIGH** — Open redirect  
6. **MEDIUM** — Production-style stack traces exposed  
7. **MEDIUM** — No requestTimeoutMs — slow handlers hold sockets  
8. **CRITICAL** — Unauthenticated user dump  
9. **CRITICAL** — IDOR on `/api/users/:id` without auth  
10. **CRITICAL** — Debug endpoint leaks JWT signing secret  
11. **HIGH** — Unauthenticated PII search  
12. **MEDIUM** — Login error messages enable account enumeration  
13. **CRITICAL** — BOLA on `/api/orders`  
14. **CRITICAL** — Mass assignment privilege escalation  
15. **CRITICAL** — Cross-user write without ownership check  
16. **CRITICAL** — Admin route checks login only, not role  
17. **CRITICAL** — Forged JWTs accepted (weak/leaked secret)  
18. **HIGH** — Unauthenticated settings write with mass assignment  

**Not recorded (underperformed):** SSRF open proxy CRITICAL, XSS HIGH — see §5.

---

## 4. Phase-by-phase (this run)

### Phase 01 — Recon · OK

- `GET /api/health` → **200** in 88ms, body includes `"express":"5"`.  
- `GET /` advertises attack surface (login, users, files, proxy, go).

### Phase 02 — Missing headers · **MEDIUM**

All six browser hardening headers missing (`X-Content-Type-Options`, `X-Frame-Options`, CSP, HSTS, Referrer-Policy, Permissions-Policy).  
**Daloy:** `secureHeaders`. **Express 5:** still not automatic.

### Phase 03 — 1.5 MiB body · **HIGH**

`POST /api/auth/login` with 1 572 908-byte body → **401** in 231ms, **not 413**.  
Server accepted the huge payload, then said “no account.”  
**Daloy:** `bodyLimitBytes` 1 MiB → 413.

### Phase 04 — Login flood · **HIGH**

40 parallel wrong logins in **362ms** → histogram `{"401":40}`, **zero 429**.  
**Daloy:** `rateLimit` / `loginThrottle`.

### Phase 05 — Path traversal · **CRITICAL** ★

```text
GET /api/files?name=../secrets/jwt-backup.txt → 200
LOOT JWT_SECRET=supersecret123
```

No password. Escapes `public/` into `secrets/`.

### Phase 06 — Open redirect · **HIGH**

```text
GET /api/go?url=https://evil-phish.example/steal → 302
Location: https://evil-phish.example/steal
```

### Phase 07 — SSRF self-proxy · **UNDERPERFORMED**

```text
GET /api/proxy?url=https://…workers.dev/api/debug/config
← RECV 404  body: error code: 1042
· Proxy probe → 404   (no CRITICAL finding)
```

**Interpretation:** Cloudflare blocked Worker **self-fetch** (error **1042**). That is **platform policy**, not “Express 5 learned SSRF hygiene.” The `/api/proxy` open-proxy route still exists; the secret was still stolen via path traversal and `/api/debug/config`.

**Stage line:** “Self-SSRF hit Cloudflare 1042. The app still gave us the JWT secret two other ways without a password.”

### Phase 08 — Stack + XSS · **mixed**

| Probe | Result | Notes |
| --- | --- | --- |
| `GET /api/boom` | **500** + stack (`worker.js:…`) | **MEDIUM** — Express still leaks stacks |
| XSS `msg=<img onerror=…>` | **403** ~14 KB body | Console said `✓ DEFENDED` — **misleading**. Cloudflare WAF blocked the payload; app HTML sink not disproven |

**Stage line:** “WAF blocked the XSS payload. That is Cloudflare, not output encoding in Express.”

### Phase 09 — Slow handler · **MEDIUM**

`GET /api/slow?ms=3000` held ~3s, returned 200. No request timeout budget.

### Phase 10 — Unauth data theft · **main scare** ★

| Request | Result |
| --- | --- |
| `GET /api/users` no auth | 4 accounts: SSN, full card, CVV |
| `GET /api/users/1` no auth | Alice PII + internal note |
| `GET /api/debug/config` | `jwtSecret`, `runtime: cloudflare-workers`, feature flags all false |
| `GET /api/search?q=oslo` | Alice + Bob addresses + SSNs |

### Phase 11 — Account enum · **MEDIUM**

| Missing user | Wrong password |
| --- | --- |
| `No account for that email` | `Incorrect password` |

Different strings → free user discovery.

### Phase 12 — Authz collapse · **CRITICAL chain** ★

1. Login Alice → JWT issued (the “we’re secured” moment).  
2. `GET /api/orders` → **5 orders / 4 users**, including payroll **$50 000**.  
3. Register disposable attacker `#5`.  
4. `PUT /api/users/5` `{role:"admin", balance:1000000}` → mass assignment.  
5. `PUT /api/users/6` as attacker → cross-user write.  
6. `GET /api/admin/stats` → **plaintext passwords** for all seed users.  
7. Forge HS256 admin JWT with leaked secret → `/api/me` accepts as VaultPay Admin.

### Phase 13 — Settings · **HIGH**

Unauth `PUT /api/settings` set `theme=pwned`, `injected=true`. Script restored settings afterward.

### Phase 14 — Raw TCP · skipped

HTTPS target → expected skip.

---

## 5. Demo expectations vs this Express 5 run

| Expectation | Met? | Notes |
| --- | --- | --- |
| Live Worker on Express 5 | Yes | `"express":"5"` |
| JWT alone insufficient | Yes | Phases 10–12 |
| Steal PII without login | Yes | Phase 10 |
| Steal JWT secret | Yes | Traversal + debug |
| Priv-esc + forge admin | Yes | Phase 12 |
| SSRF self-proxy CRITICAL | **No** | CF `1042` |
| XSS sink HIGH | **No** | CF WAF `403` |
| Rate limit absence | Yes | 40× 401, 0× 429 |
| Body limit absence | Yes | 1.5 MiB → 401 |
| Open redirect | Yes | 302 to evil host |

**Overall:** deploy + demo **success**. Same two Cloudflare platform caveats as the pre–Express-5 Workers run.

### Compared to previous Workers run (Express 4-era bundle)

| Item | Prior run | This run (Express 5) |
| --- | --- | --- |
| Health payload | no `express` field | `"express":"5"` |
| Critical count | 9 | **9** |
| SSRF self-fetch | CF 1042 | CF 1042 (unchanged) |
| XSS | CF 403 | CF 403 (unchanged) |
| Authz / PII chain | pwned | **still pwned** |

Upgrading Express **did not** close authz, rate limits, headers, or data exposure.

---

## 6. Environment notes (this machine)

| Issue | Detail |
| --- | --- |
| Zscaler TLS | Node `fetch` fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` unless `NODE_TLS_REJECT_UNAUTHORIZED=0` |
| PowerShell `Invoke-RestMethod` | Works without bypass (uses Windows cert store) |
| Warning | `(node) NODE_TLS_REJECT_UNAUTHORIZED=0` appears in the log — expected under Zscaler |

For talks from a clean network, omit the TLS env var.

---

## 7. Script labeling issues (still present)

| Issue | Evidence | Ideal fix later |
| --- | --- | --- |
| SSRF silent on 1042 | Only `· Proxy probe → 404` | Fallback external open-proxy probe; record INFO/HIGH |
| XSS marked DEFENDED on 403 | `✓ DEFENDED / OK` | Label **PLATFORM BLOCKED**, not app-defended |
| Flood IDs jump #4 → #45 | Confusing | Print collapsed range |

These do not invalidate the 9 critical findings.

---

## 8. What “fix” means in a real product

| Hole seen live | Real fix |
| --- | --- |
| Public users / IDOR | Auth + ownership |
| Debug secret | Remove; never echo secrets |
| Path traversal files | Jail path or no user paths |
| BOLA orders | Filter by `req.user.sub` |
| Mass assignment | Field allowlist; never trust `role` |
| Admin without role | `requireRole("admin")` |
| Weak JWT secret | Strong secret / asymmetric keys |
| No rate limit | Login throttle |
| Huge body | Hard body cap (1 MiB) |
| Open redirect | Allowlist |
| Open proxy | No arbitrary fetch; `fetchGuard`-style |
| Stacks in JSON | Prod redaction |
| HTML echo | Encode / don’t use text/html for user input |
| Enum login errors | One generic message |
| Missing headers | `secureHeaders` |

**DaloyJS close:** transport defaults (body limit, rate limit, headers, safe redirect, SSRF guard, redaction) + fail-closed auth patterns. Ownership checks remain app logic.

---

## 9. 5-minute talk path (this deployment)

1. SPA login Alice → “JWT secured.”  
2. Phase 10 LOOT (cards/SSNs) — no token.  
3. Path traversal → `supersecret123`.  
4. Phase 12: BOLA payroll order → mass-assign admin → forge admin JWT.  
5. Honest 15s: “Express 5 on Cloudflare. WAF blocked XSS; CF blocked self-SSRF. Database still emptied.”  
6. Close: Authn ≠ authz; defaults matter.

---

## 10. Reproduce

```bash
cd demo-attack-express/server
npm install          # express@5.2.1
npm run deploy:cf

# Attack (Zscaler laptop)
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
node ../attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama

# Clean network
node ../attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama
```

---

## 11. Cheat sheet ★

```text
NO LOGIN
  missing headers          MEDIUM
  1.5MB body               HIGH
  40 logins no 429         HIGH
  ../secrets → JWT secret  CRITICAL  ★
  open redirect            HIGH
  self-SSRF                CF 1042 (platform)
  stack traces             MEDIUM
  XSS                      CF 403 (platform)
  slow 3s                  MEDIUM
  /api/users dump          CRITICAL  ★
  /api/users/1 IDOR        CRITICAL  ★
  /api/debug/config        CRITICAL  ★
  /api/search PII          HIGH
  login enum               MEDIUM
  PUT /api/settings        HIGH

ANY USER JWT
  all orders (BOLA)        CRITICAL  ★
  mass assign admin        CRITICAL  ★
  write other user         CRITICAL  ★
  /api/admin/stats         CRITICAL  ★

LEAKED SECRET
  forge admin JWT          CRITICAL  ★

★ = projector highlights if short on time
EXPRESS 5 = modern package; NOT a security finish line
```

---

*Generated from a live engagement after redeploying Express 5.2.1 to Cloudflare Workers. Educational target only.*
