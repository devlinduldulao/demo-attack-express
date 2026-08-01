# Platform comparison — same Express 5 app

**One vulnerable API** (`server/app.js`), three runtimes:

| Runtime | Production URL | Deploy |
| --- | --- | --- |
| **Cloudflare Workers** | `https://vaultpay-api.devlinduldulao.workers.dev` | `cd server && wrangler deploy` |
| **Vercel serverless** | `https://vaultpay-api.vercel.app` | `cd server && vercel --prod --yes` |
| **Node long-running** | `http://localhost:4000` | `cd server && npm start` |

**Engagement date:** 2026-08-01 (current attacker: CORS, IMDS-class, no pollution phase, `--drama` optional).  
**CF Version ID:** `46b0d6b3-8d54-4217-8eac-c9c28dffbe09`  
**Attacker:** `attack/attack.mjs --reset --json`

---

## Attack outcomes (this engagement)

| | Cloudflare | Vercel |
| --- | --- | --- |
| Study | [`ATTACK-RUN-CLOUDFLARE.md`](ATTACK-RUN-CLOUDFLARE.md) | [`ATTACK-RUN-VERCEL.md`](ATTACK-RUN-VERCEL.md) |
| Result | **9** critical · **71** req · **4.3s** | **10** critical · **70** req · **10.1s** |
| Findings total | 23 | 23 |
| By kind | gap 4 · misconfig 3 · junior 16 | gap 4 · misconfig 3 · junior 16 |
| `"express":"5"` | Yes | Yes |
| Unauth PII / IDOR / debug secret | CRITICAL | CRITICAL |
| Path traversal JWT file | CRITICAL | CRITICAL |
| CORS `*` | HIGH misconfig | HIGH misconfig |
| Self-SSRF → debug | **1042** → external HIGH | **CRITICAL** |
| IMDS-class URL | no IMDS + HIGH no allowlist | no IMDS + HIGH no allowlist |
| BOLA / mass-assign / BFLA / forge | **YES** full climax | **YES** full climax |
| `alg:none` | rejected 401 | rejected 401 |

---

## What this means for the talk

```text
  Same incomplete Express 5 + JWT code
           │
     ┌─────┴─────┐
     ▼           ▼
 Cloudflare    Vercel
 edge 1042     self-SSRF works
     │           │
     ▼           ▼
 Still pwned   Still pwned
 (9 crit)      (10 crit)
 both forged admin
```

1. **Hosting ≠ API security** — both dump PII and accept forged admin JWT.  
2. **CF edge** changes which *probes* fail (self-fetch), not whether *authz* works.  
3. **+1 critical on Vercel** is self-SSRF of the debug secret — same app hole, different edge.  
4. Stage: `--drama --reset` on either URL; prefer either for climax (both forge).

---

## Deploy + attack

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
cd server
npx wrangler deploy
npx vercel --prod --yes
cd ..
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama --reset
node attack/attack.mjs https://vaultpay-api.vercel.app --drama --reset
```
