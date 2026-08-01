# Platform comparison — same Express 5 app

**One vulnerable API** (`server/app.js`), three runtimes:

| Runtime | Production URL | Deploy |
| --- | --- | --- |
| **Cloudflare Workers** | `https://vaultpay-api.devlinduldulao.workers.dev` | `cd server && wrangler deploy` |
| **Vercel serverless** | `https://vaultpay-api.vercel.app` | `cd server && vercel --prod --yes` |
| **Node long-running** | `http://localhost:4000` | `cd server && npm start` |

**Engagement date:** 2026-08-01 (post–prototype-pollution + CORS/IMDS attacker; **no** HARDENED mode).  
**Deploy Version (CF):** `fa70392f-4175-4922-a355-b4e3046bfc4d`  
**Attacker:** `attack/attack.mjs --reset --json` (no `--internal`)

---

## Attack outcomes (this engagement)

| | Cloudflare | Vercel |
| --- | --- | --- |
| Study | [`ATTACK-RUN-CLOUDFLARE.md`](ATTACK-RUN-CLOUDFLARE.md) | [`ATTACK-RUN-VERCEL.md`](ATTACK-RUN-VERCEL.md) |
| Result | **4** critical · **71** req · **4.5s** | **11** critical · **74** req · **11.1s** |
| Findings total | 18 | 24 |
| By kind | gap 4 · misconfig 3 · junior 11 | gap 4 · misconfig 3 · junior 17 |
| `"express":"5"` | Yes | Yes |
| Reset `prototypeKeysCleared` | Yes | Yes |
| Unauth PII / IDOR / debug secret | CRITICAL | CRITICAL |
| Path traversal JWT file | CRITICAL | CRITICAL |
| CORS `*` | HIGH misconfig | HIGH misconfig |
| Self-SSRF → debug | **1042** platform → external HIGH | **CRITICAL** |
| IMDS-class URL | 403 + HIGH no allowlist | 502 + HIGH no allowlist |
| **Prototype pollution empty order** | **Fails / bricks isolate (1101)** until reset | **CRITICAL** LOOT forged order |
| BOLA / mass-assign / BFLA / forge | **Skipped** (login dead after pollution) | **CRITICAL** all + forged admin **YES** |
| `alg:none` | n/a (authz phase skipped) | Rejected 401 (library) |

---

## What this means for the talk

```text
  Same incomplete Express 5 + JWT code
           │
     ┌─────┴─────┐
     ▼           ▼
 Cloudflare    Vercel
 edge/WAF      edge/HSTS
     │           │
     ▼           ▼
 Unauth pwn    Full chain pwn
 + pollution   (pollution + forge)
   bricks
   isolate
```

1. **Hosting ≠ API security** — both still dump PII and leak the JWT secret without a password.  
2. **Vercel** is the better **live climax** (pollution LOOT + forged admin).  
3. **Cloudflare** still valuable: edge 1042, IMDS refuse, and “pollution can take the Worker offline until reset.”  
4. **Internal pivot / redirect hop** need `--internal=URL` against a **local** API (or any host that can reach your stand-in). Not these two public URLs.

---

## Deploy both (local CLI)

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
cd server
npx wrangler deploy
npx vercel --prod --yes
```

```powershell
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --reset --json
node attack/attack.mjs https://vaultpay-api.vercel.app --reset --json
```

---

## Diff that costs criticals

| Probe | Cloudflare | Vercel |
| --- | --- | --- |
| Self open proxy | 1042 | **CRITICAL** secret |
| Prototype pollution | **1101 brick** → skip forge | **CRITICAL** + rest of chain |

Everything else in the unauth JWT thesis is **the same class of incomplete setup** on both.
