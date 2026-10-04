# Edge platform defaults ≠ API security

**Show this on screen after the attack run.**  
Same intentional **Express 5** VaultPay app on two free clouds:

| Platform | URL |
| --- | --- |
| Cloudflare Workers | `https://vaultpay-api.devlinduldulao.workers.dev` |
| Vercel serverless | `https://vaultpay-api.vercel.app` |

Full studies: [`ATTACK-RUN-CLOUDFLARE.md`](ATTACK-RUN-CLOUDFLARE.md) · [`ATTACK-RUN-VERCEL.md`](ATTACK-RUN-VERCEL.md) · [`PLATFORM-COMPARISON.md`](PLATFORM-COMPARISON.md)

**Engagement (2026-08-01):** CF **9** critical / **4.3s** · Vercel **10** critical / **10.1s** · forged admin on **both**.

---

## One sentence

**Cloudflare free / default edge protection filters some noisy attacks.  
It does not authorize your REST API.**

---

## What the attack proved (this demo)

### Cloudflare *did* interfere (this run)

| Probe | What happened | Who blocked it? |
| --- | --- | --- |
| SSRF self-fetch via `/api/proxy` to same Worker | HTTP **404** + `error code: 1042` | **Cloudflare** (Worker fetch policy) |

That is **edge / runtime platform** behavior — not Express 5 “becoming secure.”  
External open proxy (`example.com`) still succeeded → **HIGH** app-code.

### Vercel *did little* for these probes (same app)

| Probe | Vercel result |
| --- | --- |
| SSRF self-fetch to own debug URL | **200** — returned `jwtSecret` (**CRITICAL**) |
| Mild HTML echo XSS class | **200** — reflected as `text/html` (**HIGH**) |
| HSTS | **Present** (edge) — only partial header help |
| Unauth PII / BOLA / forge admin | Still **pwned** |

### Neither platform stopped (app still pwned)

| Attack | Result | Needs login? | kind | Whose fault? |
| --- | --- | --- | --- | --- |
| `GET /api/users` full PII dump | **CRITICAL** — SSN, card, CVV | No | app-code | Route logic |
| Path traversal → JWT secret | **CRITICAL** | No | app-code | Route logic |
| `GET /api/debug/config` secret leak | **CRITICAL** | No | app-code | Route logic |
| IDOR `/api/users/:id` | **CRITICAL** | No | app-code | Route logic |
| CORS `Access-Control-Allow-Origin: *` | **HIGH** | No | **misconfig** | Demo bolted on `cors({ origin: "*" })` — **not** CF/Vercel, **not** Express default |
| 40× login flood, zero **429** | **HIGH** | No | framework-gap | Express has no login throttle |
| ~1.5 MiB body accepted (not 413) | **HIGH** | No | **misconfig** | Demo `BODY_LIMIT=50mb` — Express `json()` default is **100kb** |
| Open redirect to evil host | **HIGH** | No | app-code | Route logic |
| Stack leak on `/api/boom` | **MEDIUM** | No | **misconfig** | Custom error JSON with `stack` — not Express `finalhandler` prod default |
| Missing secure headers / `X-Powered-By` | **MEDIUM** / **INFO** | No | framework-gap | Express does not install Helmet |
| BOLA: all customers’ orders | **CRITICAL** | Any user JWT | app-code | Route logic |
| Mass assignment → `role: admin` | **CRITICAL** | Any user JWT | app-code | Route logic |
| Admin stats dumps passwords | **CRITICAL** | Any user JWT | app-code | Route logic |
| Forged admin JWT with leaked secret | **CRITICAL** | No (after secret leak) | app-code | Route logic |

**Final score (this engagement):**

| Cloud | Result |
| --- | --- |
| Cloudflare | `API PWNED — 9 critical · 71 requests · 4.3s` |
| Vercel | `API PWNED — 10 critical · 70 requests · 10.1s` |

---

## Whose fault? (cloud deploy honesty)

Same `server/app.js` on both clouds. **CF/Vercel do not invent the three misconfigs** — they only host the app. Terminal tags show `(misconfig)` so the room does not blame Express defaults or the edge.

| Finding on both CF + Vercel | Terminal kind | **Not** whose fault | **Is** whose fault | Where it is set |
| --- | --- | --- | --- | --- |
| CORS `*` | `misconfig` | Cloudflare / Vercel / bare Express | This demo’s app | `cors({ origin: "*" })` in `server/app.js` |
| ~50mb JSON bodies | `misconfig` | Cloudflare / Vercel / Express `json()` 100kb | This demo’s app + env | `BODY_LIMIT` / `jsonBody` — `wrangler.toml` `[vars]`, Vercel env, `app.js` default |
| Stack in 500 JSON | `misconfig` | Express prod `finalhandler` (redacts when `NODE_ENV=production`) | This demo’s app | `/api/boom` + custom error middleware in `app.js` |
| No rate limit / no Helmet headers | `framework-gap` | “We forgot a cloud checkbox” | Express does not ship these | Must add middleware yourself |
| BOLA / IDOR / proxy / traversal / forge | `app-code` | Express router / free hosting | Tutorial-style routes | Handlers in `app.js` |
| CF **1042** self-fetch; sometimes edge HSTS | `◇ PLATFORM` | The app learning authz | Edge / Worker runtime | Platform policy only |

**Talk line:**  
> “When you see `(misconfig)` on the cloud run, that is **us** — the deploy env and the app — not Express inventing open CORS or 50mb bodies, and not Cloudflare failing to ‘secure the API.’”

**Same on both clouds:** `By kind: framework-gap: 4 · misconfig: 3 · app-code: 16`  
**Differs by platform:** only probe outcomes tagged `◇ PLATFORM` (and Vercel’s +1 critical self-SSRF).

Re-run for a fresh terminal transcript (logs are local / gitignored):

```powershell
node --no-warnings attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --reset --json *> ATTACK-RUN-CLOUDFLARE-LATEST.log
node --no-warnings attack/attack.mjs https://vaultpay-api.vercel.app --reset --json *> ATTACK-RUN-VERCEL-LATEST.log
```

Every finding line should show `(misconfig)`, `(framework-gap)`, or `(app-code)`; platform blocks show `◇ PLATFORM`.

---

## What “Cloudflare by default” means here

### You get (roughly)

- Free global host (`*.workers.dev`)
- HTTPS at the edge
- Platform rules (e.g. Worker cannot freely self-fetch → **1042**)
- DDoS absorption at CDN scale (not tested as full DDoS in this demo)
- Sometimes edge headers (e.g. HSTS) — **not** a full Helmet suite on app routes

### You do **not** get automatically

- Authentication on every route  
- Authorization / ownership (BOLA)  
- Field allowlists (mass assignment)  
- App rate limits on login  
- Safe body limits (this demo **ships** `BODY_LIMIT=50mb` on purpose — **misconfig**)  
- Closed CORS (this demo **ships** `origin: "*"` — **misconfig**)  
- Stack redaction (this demo’s error handler leaks — **misconfig**)  
- “Never return secrets in JSON”  
- Role checks (`requireAuth` ≠ `requireRole`)

Deploy guides that document the intentional weak knobs: [`server/DEPLOY-CLOUDFLARE.md`](server/DEPLOY-CLOUDFLARE.md) · [`server/DEPLOY-VERCEL.md`](server/DEPLOY-VERCEL.md).

---

## Console legend (projector)

| Tag | Meaning | Blame for the talk |
| --- | --- | --- |
| `✗ APP HOLE` | Probe hit an application weakness | Read the `(kind)` next to the finding |
| `◇ PLATFORM` | Edge/runtime blocked the **probe** — app may still be open | **Cloud / Worker** — not “API is secure now” |
| `(framework-gap)` | Express does not provide this control by default | **Framework** incomplete box |
| `(misconfig)` | Demo weakened a safer Express default (CORS, body, stack) | **This app / deploy vars** — not CF, not Express default |
| `(app-code)` | Vulnerable route / app logic you wrote | **Developer route code** |

---

## Talk close (five lines)

1. **Authn ≠ authz.**  
2. **JWT is one control**, not a security model.  
3. **Edge ≠ API authorization** — same code, two clouds, both pwned.  
4. **`(misconfig)` is us** — open CORS, 50mb bodies, stack leak ship in the demo app/env, not as Express or CF defaults.  
5. **Nothing is not a security model** — ownership, allowlists, closed debug, egress policy: you must set them up.

Only attack systems you own. Tear down public demos when finished — [`TEARDOWN.md`](TEARDOWN.md).
