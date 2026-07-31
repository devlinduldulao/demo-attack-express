# Cloudflare edge defaults ≠ API security

**Show this on screen after the attack run.**  
Demo target: Express 5 VaultPay on Cloudflare Workers  
Live URL: `https://vaultpay-api.devlinduldulao.workers.dev`

---

## One sentence

**Cloudflare free / default edge protection filters some noisy attacks.  
It does not authorize your REST API.**

---

## What the attack proved (this demo)

### Cloudflare *did* interfere

| Probe | What happened | Who blocked it? |
| --- | --- | --- |
| XSS payload in `/api/echo` | HTTP **403**, large WAF-style body | **Cloudflare** (platform) |
| SSRF self-fetch via `/api/proxy` to same Worker | HTTP **404** + `error code: 1042` | **Cloudflare** (Worker fetch policy) |

Those are **edge / runtime platform** behaviors — not Express 5 “becoming secure.”

### Cloudflare *did not* stop (app still pwned)

| Attack | Result | Needs login? |
| --- | --- | --- |
| `GET /api/users` full PII dump | **CRITICAL** — SSN, card, CVV | No |
| Path traversal → JWT secret | **CRITICAL** | No |
| `GET /api/debug/config` secret leak | **CRITICAL** | No |
| IDOR `/api/users/:id` | **CRITICAL** | No |
| 40× login flood, zero **429** | **HIGH** | No |
| ~1.5 MiB body accepted (not 413) | **HIGH** | No |
| Open redirect to evil host | **HIGH** | No |
| BOLA: all customers’ orders | **CRITICAL** | Any user JWT |
| Mass assignment → `role: admin` | **CRITICAL** | Any user JWT |
| Admin stats dumps passwords | **CRITICAL** | Any user JWT |
| Forged admin JWT with leaked secret | **CRITICAL** | No (after secret leak) |

**Final score (this engagement):**  
`API PWNED — 9 critical · 5 high · 4 medium · 68 requests`

---

## What “Cloudflare by default” means here

### You get (roughly)

- Free global host (`*.workers.dev`)
- HTTPS at the edge
- Some bot / WAF-style filtering (known XSS patterns, etc.)
- Platform rules (e.g. Worker cannot freely self-fetch → **1042**)
- DDoS absorption at CDN scale (not tested as full DDoS in this demo)

### You do **not** get automatically

- Authentication on every route  
- Authorization / ownership (BOLA)  
- Field allowlists (mass assignment)  
- App rate limits on login  
- Safe defaults for body size, response headers, error redaction  
- “Never return secrets in JSON”

**Edge filter ≠ application security model.**

---

## Layers (draw this mentally)

```text
  Internet
      │
      ▼
┌─────────────────────────────┐
│  Cloudflare edge            │  ← free: TLS, some WAF/bot noise
│  (WAF 403, fetch 1042, …)   │     paid/config: custom WAF, rate limit, etc.
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  YOUR Express 5 app         │  ← JWT on a few routes ≠ done
│  routes, authz, body, data  │     THIS is where VaultPay failed open
└─────────────────────────────┘
```

Cloudflare can sit **in front**.  
It does not rewrite your handlers to check `order.userId === req.user.sub`.

---

## Free Workers vs “more Cloudflare”

| Capability | Free / bare Worker (this demo) | Extra products / config (not this demo) |
| --- | --- | --- |
| Host + HTTPS | Yes | Yes |
| Some managed rules / bot noise | Often yes | Stronger with WAF / Bot Management |
| Custom rate limit rules | Not automatic | Rate Limiting / WAF rules |
| App authz / IDOR prevention | **No** | **Still no** — still your code (or API gateway policies you design) |
| JWT secret not leaked | **No** | **Still your code** |

Even a paid WAF cannot invent business rules you never wrote.

---

## Comparison for the talk (3 columns)

| Layer | Example control | Did it save VaultPay? |
| --- | --- | --- |
| **Cloudflare edge** | Block XSS string, block self-fetch | Partial — 2 probes only |
| **Express 5** | Framework major upgrade | No — still no authz defaults |
| **JWT** | Login returns a token | No — unauth routes + bad authz |
| **App design** | Auth on every route, ownership, allowlists | **Would have** — missing here |
| **Daloy-style defaults** | Body limit, rate limit, headers, safe redirect, SSRF guard | **Would have** blocked many *transport* holes |

---

## Lines you can read aloud

1. **“Cloudflare blocked the flashy XSS payload. It did not stop us from downloading every credit card without a password.”**

2. **“Error 1042 is the platform refusing a Worker self-fetch. Our open-proxy route is still there; we already stole the JWT secret two other ways.”**

3. **“Upgrading to Express 5 and deploying to Cloudflare is good ops. It is not a substitute for authorization.”**

4. **“JWT proved someone could log in. It never decided who may read whose data.”**

---

## What to do for real APIs (short checklist)

1. **Default-deny** — every route authenticated unless explicitly public  
2. **Authorize per resource** — ownership / roles (BOLA is the #1 API killer)  
3. **Allowlist write fields** — never trust `req.body.role`  
4. **Rate-limit login** — 429 under flood  
5. **Hard body limits** — 413 before parse  
6. **No debug/secret endpoints** in production  
7. **Secure headers + prod error redaction**  
8. **Edge WAF** as defense-in-depth — not the only control  
9. Prefer frameworks with **secure defaults** so juniors don’t start from bare Express + JWT

---

## Demo proof points (project these numbers)

```text
Target:     Express 5 on Cloudflare Workers
Health:     "express": "5"
Result:     API PWNED — 9 critical
Stolen:     4 users (SSN/card/CVV), 5 orders, JWT secret
Escalation: mass-assign admin + forged admin JWT
CF blocked: XSS 403, SSRF self-fetch 1042
CF missed:  almost everything that mattered
```

---

## Related docs in this repo

| Doc | Use |
| --- | --- |
| [`ATTACK-RUN-STUDY.md`](ATTACK-RUN-STUDY.md) | Full phase-by-phase of the live run |
| [`HOW-TO-ATTACK.md`](HOW-TO-ATTACK.md) | How to reproduce |
| [`README.md`](README.md) | Project overview + Daloy mapping |

---

*Educational only. Attack only systems you own.*
