# Platform comparison — same Express 5 app

**One vulnerable API** (`server/app.js`), three runtimes:

| Runtime | Production URL | Deploy |
| --- | --- | --- |
| **Cloudflare Workers** | `https://vaultpay-api.devlinduldulao.workers.dev` | `cd server && wrangler deploy` |
| **Vercel serverless** | `https://vaultpay-api.vercel.app` | `cd server && vercel --prod --yes` |
| **Node long-running** | `http://localhost:4000` | `cd server && npm start` |

GitHub private vs public **does not matter** for either cloud deploy in this repo: both were done **from the local machine** with the CLI (OAuth already logged in).

---

## Attack outcomes (Express 5 only)

| | Cloudflare | Vercel |
| --- | --- | --- |
| Study doc | [`ATTACK-RUN-CLOUDFLARE.md`](ATTACK-RUN-CLOUDFLARE.md) | [`ATTACK-RUN-VERCEL.md`](ATTACK-RUN-VERCEL.md) |
| Live result | API PWNED — **9** critical | API PWNED — **10** critical |
| `"express":"5"` | Yes | Yes |
| Unauth PII / IDOR / debug secret | CRITICAL | CRITICAL |
| Path traversal JWT secret | CRITICAL | CRITICAL |
| BOLA / admin / forge admin | CRITICAL | CRITICAL |
| Login flood no 429 | Yes | Yes |
| ~1.5 MiB body accepted | Yes | Yes |
| Open redirect | Yes | Yes |
| SSRF → own `/api/debug/config` | **Blocked** CF `1042` | **Works** (CRITICAL) |
| Mild HTML XSS sink | Proven (mild payload) | Proven |
| Noisy XSS `onerror=alert` | Often WAF **403** | Not needed |
| HSTS from edge | Missing in CF run | **Present** |
| Platform notes in attacker | Self-fetch 1042 | None (full open) |

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
2. Cloudflare free defaults blocked **some** noise (XSS pattern, self-fetch).  
3. Vercel free defaults gave **HSTS** but allowed **SSRF self-fetch** and full HTML echo.  
4. Neither platform stopped **IDOR, secret leak, BOLA, or forged JWT**.

**Screen slide for edge nuance:** [`CLOUDFLARE-VS-APP-SECURITY.md`](CLOUDFLARE-VS-APP-SECURITY.md)  
(Vercel section below can be read alongside it.)

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

## Deploy both (local CLI)

```powershell
# Corporate TLS if needed
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"

cd server
npm install

# Cloudflare
npx wrangler deploy

# Vercel
vercel --prod --yes

cd ..
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --skip-slow
node attack/attack.mjs https://vaultpay-api.vercel.app --skip-slow
```

---

## Serverless in-memory lesson (both clouds)

- DB lives in process RAM per isolate/instance.  
- Cold start → re-seed.  
- Concurrent instances do not share registered users.  
- Attacker uses **seed accounts** for mass-assign / cross-user so demos stay reliable.

---

*Educational only. Same intentional holes; different edge behaviors.*
