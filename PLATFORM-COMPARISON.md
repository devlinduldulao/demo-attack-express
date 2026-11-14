# Platform comparison — same Express 5 app

> Both columns were re-captured on 2026-11-14 with the current attack script
> (`attack/attack.mjs`, the full 16-phase run). Severities are demo-author
> ratings, not CVSS; counts are finding records, not unique root causes.
>
> This page compares **hosts** for the same Express app. For the same app on a
> different **framework**, see [`server-daloy/README.md`](server-daloy/README.md)
> (`npm run compare`).

**One vulnerable API** (`server/app.js`), three runtimes:

| Runtime | Production URL | Deploy |
| --- | --- | --- |
| **Cloudflare Workers** | `https://vaultpay-api.devlinduldulao.workers.dev` | `cd server && wrangler deploy` |
| **Vercel serverless** | `https://vaultpay-api.vercel.app` | `cd server && vercel --prod --yes` |
| **Node long-running** | `http://localhost:4000` | `cd server && npm start` |

**Engagement date:** 2026-11-14, both hosts. Neither was redeployed for the capture.
**Attacker:** `attack/attack.mjs --reset --json` (the full 16-phase run).

---

## Attack outcomes (this engagement)

| | Cloudflare | Vercel |
| --- | --- | --- |
| Study | [`ATTACK-RUN-CLOUDFLARE.md`](ATTACK-RUN-CLOUDFLARE.md) | [`ATTACK-RUN-VERCEL.md`](ATTACK-RUN-VERCEL.md) |
| Result, full script | **9** critical · **71** req · **4.1s** | **10** critical · **71** req · **9.1s** |
| Result, short script | **8** critical · **57** req · **0.7s** | **9** critical · **56** req · **3.1s** |
| Finding records (full) | 22 | 22 |
| By kind (full) | gap 4 · misconfig 3 · app-code 15 | gap 4 · misconfig 3 · app-code 15 |
| `"express":"5"` | Yes | Yes |
| Unauth PII / IDOR / debug secret | CRITICAL | CRITICAL |
| Path traversal JWT file | CRITICAL | CRITICAL |
| CORS `*` on health | INFO misconfig | INFO misconfig |
| Self-SSRF → debug | **1042** `◇ PLATFORM` → external fetch HIGH | **CRITICAL** |
| Metadata URL | `403`, no finding | `502`, no finding |
| BOLA / mass-assign / BFLA / forge | **YES** full climax | **YES** full climax |
| `alg:none` | rejected `401` by `jsonwebtoken` | **403 at the edge** `◇ PLATFORM` (`x-vercel-mitigated: deny`) |
| HSTS header | missing | present (platform) |

---

## What this means for the talk

```text
  Same incomplete Express 5 + JWT code
           │
     ┌─────┴─────┐
     ▼           ▼
 Cloudflare    Vercel
 edge 1042     edge denies alg:none
 on self-SSRF  self-SSRF works
     │           │
     ▼           ▼
 Still pwned   Still pwned
 (9 crit)      (10 crit)
 both forged admin
```

1. **Hosting ≠ API security** — both dump PII and accept forged admin JWT.  
2. **Each edge** stops one *probe* (Cloudflare: the self-fetch; Vercel: the unsigned token), not whether *authz* works.  
3. **+1 critical on Vercel** is self-SSRF of the debug secret — same app hole, different edge.  
4. Stage: `--drama --reset` on either URL; prefer either for climax (both forge).

---

## Same misconfigs on both clouds (not the platform’s fault)

`By kind` is **identical**: `framework-gap: 4 · misconfig: 3 · app-code: 15`.
Cloud hosting does not create or remove those three misconfigs — they are in **shared app source + deploy vars**.

| Terminal finding | kind | CF | Vercel | Whose fault? |
| --- | --- | --- | --- | --- |
| Health response permits cross-origin reads | **misconfig** | INFO | INFO | Demo `cors({ origin: "*" })` in `app.js` — bare Express has **no** CORS |
| Login accepts approximately 1.5 MiB JSON body | **misconfig** | HIGH | HIGH | Demo `BODY_LIMIT=50mb` (`wrangler.toml` / Vercel env / `app.js`) — Express `json()` default **100kb** → 413 |
| Custom handler exposes stack trace | **misconfig** | MEDIUM | MEDIUM | Demo `/api/boom` + error middleware — not Express prod `finalhandler` |
| No login throttling / secure headers missing | **framework-gap** | same | same (HSTS added by Vercel) | Express does not ship these |
| BOLA / forge / PII dump / … | **app-code** | same | same | Route logic |
| Self-SSRF of debug secret | **app-code** hole; outcome differs | **1042** `◇ PLATFORM` | **CRITICAL** | Edge policy ≠ authz; open proxy is still app-code |

**Say on stage:**  
> “Open CORS and 50mb bodies show up on Cloudflare **and** Vercel with the same `(misconfig)` tag. That is the demo deploy — not ‘Workers are insecure by default’ and not ‘Express accepts 50mb out of the box.’”

**Terminal on both URLs** (after the run, same report block):

```text
Whose fault? ...
  (misconfig)     3 — ... Not Express defaults. Not Cloudflare/Vercel inventing them.
Misconfig detail (cloud hosts still show these — same app.js):
  [INFO] (misconfig) Health response permits cross-origin reads
  [HIGH] (misconfig) Login accepts approximately 1.5 MiB JSON body
  [MEDIUM] (misconfig) Custom handler exposes stack trace
```text
Whose fault? ...
  (misconfig)     3 — ... Not Express defaults. Not Cloudflare/Vercel inventing them.
Misconfig detail (cloud hosts still show these — same app.js):
  [HIGH] (misconfig) CORS ...
  [HIGH] (misconfig) Demo misconfig: custom parser allows ~50mb bodies
  [MEDIUM] (misconfig) ... stack ...
```

Attack phases: CORS (`GET /api/health` + evil Origin) → oversized `POST /api/auth/login` → stack via `/api/boom`.  
Full blame matrix: [`CLOUDFLARE-VS-APP-SECURITY.md`](CLOUDFLARE-VS-APP-SECURITY.md#whose-fault-cloud-deploy-honesty).  
Committed excerpts: [`ATTACK-RUN-CLOUDFLARE.md`](ATTACK-RUN-CLOUDFLARE.md) · [`ATTACK-RUN-VERCEL.md`](ATTACK-RUN-VERCEL.md).  
Speaker script: [`TALK.md`](TALK.md#terminal-whose-fault-on-cloud-runs).

---

## Deploy + attack

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
cd server
npx wrangler deploy
npx vercel --prod --yes
cd ..
node --no-warnings attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama --reset
node --no-warnings attack/attack.mjs https://vaultpay-api.vercel.app --drama --reset
```
