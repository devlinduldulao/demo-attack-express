# 5-minute talk script (API only, no SPA)

Projector order: terminal → optional markdown slides.

| Slide / screen | File |
| --- | --- |
| Attack console | live terminal |
| Edge vs app | [`CLOUDFLARE-VS-APP-SECURITY.md`](CLOUDFLARE-VS-APP-SECURITY.md) |
| CF study | [`ATTACK-RUN-CLOUDFLARE.md`](ATTACK-RUN-CLOUDFLARE.md) |
| Vercel study | [`ATTACK-RUN-VERCEL.md`](ATTACK-RUN-VERCEL.md) |
| CF vs Vercel | [`PLATFORM-COMPARISON.md`](PLATFORM-COMPARISON.md) |

---

## 0:00 — Setup (before audience)

```powershell
# Repo root
cd server
npx wrangler deploy   # if needed
cd ..
# Zscaler laptop only:
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
```

Hit health once so cold start is done:

```powershell
Invoke-RestMethod https://vaultpay-api.devlinduldulao.workers.dev/api/health
```

---

## 0:00–0:45 — Frame

**Show:** browser or terminal `GET /api/health`

```text
{ "ok": true, "service": "vaultpay-api", "express": "5", ... }
```

**Say:**

> “Junior tutorial: Express 5, JWT login, deployed on Cloudflare for free.  
> They think: modern stack + JWT + CDN = done.”

Optional one-liner login proof (shows JWT exists — not that the API is safe):

```powershell
# PowerShell
$body = '{"email":"alice@example.com","password":"password123"}'
(Invoke-RestMethod -Method POST -Uri https://vaultpay-api.devlinduldulao.workers.dev/api/auth/login -ContentType application/json -Body $body).token
```

> “Login works. We got a Bearer token. Feels finished.”

---

## 0:45–3:30 — Attack

```powershell
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama
```

**While it runs, narrate only the scares:**

| When you see… | Say… |
| --- | --- |
| Phase 05 LOOT `JWT_SECRET` | “No password. We walked out of public files into secrets.” |
| Phase 10 LOOT cards / SSN | “Still no token. Every customer card and SSN.” |
| Phase 12 BOLA orders | “Alice’s JWT reads payroll transfers for everyone.” |
| Phase 12 mass-assign admin | “We PUT role admin. JWT never stopped it.” |
| Phase 12 forged admin | “We stopped needing their password. We forged the token.” |
| `◇ PLATFORM` / CF 403 or 1042 | “That’s Cloudflare edge — not the app learning authz.” |

Do **not** over-explain headers/flood unless you have time.

---

## 3:30–4:30 — Edge slide

**Show:** [`CLOUDFLARE-VS-APP-SECURITY.md`](CLOUDFLARE-VS-APP-SECURITY.md)

**Say:**

> “Cloudflare blocked the noisy XSS string and blocked Worker self-fetch.  
> It did not stop the card dump or the forged admin.  
> Edge filters are not API authorization.”

---

## 4:30–5:00 — Close

**Say:**

1. Authn ≠ authz.  
2. Express 5 + JWT + Cloudflare free is not a security model.  
3. Prefer secure defaults (body limits, rate limits, headers, fail-closed auth) — e.g. DaloyJS — and still write ownership checks.  
4. “Only attack systems you own.”

---

## If the room is hostile / short on time (2 minutes)

1. Health → express 5  
2. `node attack/attack.mjs URL` without `--drama`  
3. Jump scroll to LOOT users + JWT_SECRET + DEMO RESULT  
4. One line: Cloudflare ≠ authz  

---

## What makes this demo work

| Strength | Why it lands |
| --- | --- |
| Unauth PII first | Audience gasps before “login” |
| Path traversal secret | Concrete LOOT line |
| BOLA + forge chain | JWT myth dies on screen |
| CF platform notes | Prevents “Cloudflare fixed it” misread |
| Daloy map | Natural product/story hook for you |

## What not to claim

- That free Cloudflare has “no protection” (it blocked two probes)  
- That Express 5 is insecure as a framework (the *app design* is)  
- That Daloy invents ownership rules for free (authz is still yours)
