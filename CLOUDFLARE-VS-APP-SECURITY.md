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

| Attack | Result | Needs login? | kind |
| --- | --- | --- | --- |
| `GET /api/users` full PII dump | **CRITICAL** — SSN, card, CVV | No | app-code |
| Path traversal → JWT secret | **CRITICAL** | No | app-code |
| `GET /api/debug/config` secret leak | **CRITICAL** | No | app-code |
| IDOR `/api/users/:id` | **CRITICAL** | No | app-code |
| 40× login flood, zero **429** | **HIGH** | No | framework-gap |
| ~1.5 MiB body accepted (not 413) | **HIGH** | No | **misconfig** (Express default 100kb) |
| Open redirect to evil host | **HIGH** | No | app-code |
| Stack leak on `/api/boom` | **MEDIUM** | No | **misconfig** |
| BOLA: all customers’ orders | **CRITICAL** | Any user JWT | app-code |
| Mass assignment → `role: admin` | **CRITICAL** | Any user JWT | app-code |
| Admin stats dumps passwords | **CRITICAL** | Any user JWT | app-code |
| Forged admin JWT with leaked secret | **CRITICAL** | No (after secret leak) | app-code |

**Final score (this engagement):**

| Cloud | Result |
| --- | --- |
| Cloudflare | `API PWNED — 9 critical · 71 requests · 4.3s` |
| Vercel | `API PWNED — 10 critical · 70 requests · 10.1s` |

---

## What “Cloudflare by default” means here

### You get (roughly)

- Free global host (`*.workers.dev`)
- HTTPS at the edge
- Platform rules (e.g. Worker cannot freely self-fetch → **1042**)
- DDoS absorption at CDN scale (not tested as full DDoS in this demo)

### You do **not** get automatically

- Authentication on every route  
- Authorization / ownership (BOLA)  
- Field allowlists (mass assignment)  
- App rate limits on login  
- Safe app defaults for body size (this demo **raised** the limit on purpose)  
- “Never return secrets in JSON”  
- Role checks (`requireAuth` ≠ `requireRole`)

---

## Console legend (projector)

| Tag | Meaning |
| --- | --- |
| `✗ APP HOLE` | Application / app-code / misconfig finding |
| `◇ PLATFORM` | Edge/runtime blocked the **probe** — app may still be open |
| `(framework-gap)` | Express does not provide this control by default |
| `(misconfig)` | Demo weakened a safer default (body, stack, …) |
| `(app-code)` | Vulnerable route / app logic you wrote (not Express default) |

---

## Talk close (four lines)

1. **Authn ≠ authz.**  
2. **JWT is one control**, not a security model.  
3. **Edge ≠ API authorization** — same code, two clouds, both pwned.  
4. **Nothing is not a security model** — ownership, allowlists, closed debug, egress policy: you must set them up.

Only attack systems you own. Tear down public demos when finished — [`TEARDOWN.md`](TEARDOWN.md).
