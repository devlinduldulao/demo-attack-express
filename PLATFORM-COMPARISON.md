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
| By kind | gap 4 · misconfig 3 · app-code 16 | gap 4 · misconfig 3 · app-code 16 |
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

## Same misconfigs on both clouds (not the platform’s fault)

`By kind` is **identical**: `framework-gap: 4 · misconfig: 3 · app-code: 16`.  
Cloud hosting does not create or remove those three misconfigs — they are in **shared app source + deploy vars**.

| Terminal finding | kind | CF | Vercel | Whose fault? |
| --- | --- | --- | --- | --- |
| CORS misconfig allows any browser origin | **misconfig** | HIGH | HIGH | Demo `cors({ origin: "*" })` in `app.js` — bare Express has **no** CORS |
| Demo misconfig: custom ~50mb bodies | **misconfig** | HIGH | HIGH | Demo `BODY_LIMIT=50mb` (`wrangler.toml` / Vercel env / `app.js`) — Express `json()` default **100kb** → 413 |
| Misconfig: custom error handler leaks stack | **misconfig** | MEDIUM | MEDIUM | Demo `/api/boom` + error middleware — not Express prod `finalhandler` |
| No rate limiting / no secure headers | **framework-gap** | same | same | Express does not ship these |
| BOLA / forge / PII dump / … | **app-code** | same | same | Route logic |
| Self-SSRF of debug secret | **app-code** hole; outcome differs | **1042** `◇ PLATFORM` | **CRITICAL** | Edge policy ≠ authz; open proxy is still app-code |

**Say on stage:**  
> “Open CORS and 50mb bodies show up on Cloudflare **and** Vercel with the same `(misconfig)` tag. That is the demo deploy — not ‘Workers are insecure by default’ and not ‘Express accepts 50mb out of the box.’”

**Terminal on both URLs** (after the run, same report block):

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
