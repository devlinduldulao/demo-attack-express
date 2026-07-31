# Platform comparison — same Express 5 app

**One vulnerable API** (`server/app.js`), three runtimes:

| Runtime | Production URL | Deploy |
| --- | --- | --- |
| **Cloudflare Workers** | `https://vaultpay-api.devlinduldulao.workers.dev` | `cd server && wrangler deploy` |
| **Vercel serverless** | `https://vaultpay-api.vercel.app` | `cd server && vercel --prod --yes` |
| **Node long-running** | `http://localhost:4000` | `cd server && npm start` |

GitHub private vs public **does not matter** for either cloud deploy in this repo: both were done **from the local machine** with the CLI.

**Engagement date:** 2026-07-31 (post–finding-kinds / green-run codebase; vulnerable mode on both clouds).  
**Attacker:** `attack/attack.mjs --reset --json` (current script: Enter-drama capable, kinds, OWASP, forgery last, elapsed time).

---

## Attack outcomes (Express 5 only)

| | Cloudflare | Vercel |
| --- | --- | --- |
| Study doc | [`ATTACK-RUN-CLOUDFLARE.md`](ATTACK-RUN-CLOUDFLARE.md) | [`ATTACK-RUN-VERCEL.md`](ATTACK-RUN-VERCEL.md) |
| Live result | API PWNED — **9** critical · **68** req · **4.6s** | API PWNED — **10** critical · **67** req · **10.0s** |
| Findings total | 21 | 21 |
| By kind | gap 4 · misconfig 2 · junior 15 | gap 4 · misconfig 2 · junior 15 |
| `"express":"5"` / `hardened:false` | Yes | Yes |
| Unauth PII / IDOR / debug secret | CRITICAL | CRITICAL |
| Path traversal JWT secret | CRITICAL | CRITICAL |
| BOLA / mass-assign / admin / forge | CRITICAL (climax last) | CRITICAL (climax last) |
| Login flood no 429 | Yes (~404 ms batch) | Yes (~1075 ms batch) |
| ~1.5 MiB body accepted | Yes (**misconfig**, not Express default) | Yes (**misconfig**) |
| Open redirect | Yes | Yes |
| SSRF → own `/api/debug/config` | **Blocked** CF `1042` → external proxy **HIGH** | **Works** (**CRITICAL**) |
| Mild HTML XSS sink | Proven | Proven |
| HSTS from edge | Missing in this CF run | **Present** (preload) |
| Platform notes in attacker | Self-fetch 1042 | None (full open) |
| Forged admin JWT | YES | YES |

---

## What this means for the talk

```text
  Same junior Express 5 + JWT code
           │
     ┌─────┴─────┐
     ▼           ▼
 Cloudflare    Vercel
 edge/WAF      edge/HSTS
     │           │
     ▼           ▼
  Still pwned  Still pwned
  (9 crit)     (10 crit)
```

1. **Hosting platform ≠ application security.**  
2. Cloudflare free defaults blocked **self-fetch** (1042). Open proxy still works for other URLs.  
3. Vercel free defaults gave **HSTS** but allowed **SSRF self-fetch** of the debug secret.  
4. Neither platform stopped **IDOR, secret leak, BOLA, mass-assign, or forged JWT**.  
5. Finding **kinds** keep the room honest: body limit and stack leak are **misconfig**, not Express defaults.

**Screen slide for edge nuance:** [`CLOUDFLARE-VS-APP-SECURITY.md`](CLOUDFLARE-VS-APP-SECURITY.md)

**Local green contrast (same attack script):**

```powershell
npm run demo:hardened   # DEMO RESULT: 0 critical
```

---

## Vercel edge in one breath

| Helped | Did not help |
| --- | --- |
| HSTS header | Authz / ownership |
| Free HTTPS + host | Rate limit on login |
| | Body 413 on 1.5 MiB |
| | Blocking open proxy |
| | Stopping PII dump |

---

## Cloudflare edge in one breath

| Helped | Did not help |
| --- | --- |
| Self-fetch block (1042) | Authz / ownership |
| Free HTTPS + host | Rate limit on login |
| | Body 413 on 1.5 MiB |
| | Stopping external open proxy |
| | Stopping PII dump / forge |

---

## Deploy both (local CLI)

```powershell
# Corporate TLS if needed
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"

cd server
npm install

# Cloudflare
npx wrangler deploy
# → https://vaultpay-api.<you>.workers.dev

# Vercel
npx vercel --prod --yes
# → https://vaultpay-api.vercel.app
```

Then from **repo root**:

```powershell
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --reset --json
node attack/attack.mjs https://vaultpay-api.vercel.app --reset --json
```

---

## Diff that costs a critical

| Probe | Cloudflare | Vercel |
| --- | --- | --- |
| `GET /api/proxy?url=<self>/api/debug/config` | 1042 / not secret | **200 + jwtSecret** → +1 CRITICAL |

Everything else in the JWT thesis chain is **the same pwn** on both.
