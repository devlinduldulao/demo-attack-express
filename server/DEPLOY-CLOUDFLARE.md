# Deploy VaultPay Express 5 to Cloudflare Workers

This API is **Express 5.x** (`express@^5.2.1`; package `engines.node` is **>=24**). See
[`../EXPRESS-V5.md`](../EXPRESS-V5.md), the
[Express 5 migration guide](https://expressjs.com/en/guide/migrating-5/), and the
[v5 release post](https://expressjs.com/en/blog/2024-10-15-v5-release/).

There is **no SPA** in this repo. Deploy the API, then run `attack/attack.mjs` against the Worker URL.

Follows Cloudflare’s official Express-on-Workers pattern
([Deploy an Express.js application on Cloudflare Workers](https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/)):

- `nodejs_compat` compatibility flag
- `app.listen(PORT)` + `export default httpServerHandler({ port: PORT })` from `cloudflare:node`

## Prerequisites

1. Cloudflare account (free plan is enough)
2. Node.js 18+ (required by Express 5)
3. One-time login:

```bash
cd server
npm install
npx wrangler login
```

## One-command deploy

```bash
cd server
npm run deploy:cf
```

Or from the repository root:

```bash
npm run deploy:cf
```

Wrangler prints a URL like:

```text
https://vaultpay-api.<your-subdomain>.workers.dev
```

## Local Workers runtime

```bash
cd server
npm run dev:cf
# → http://127.0.0.1:8787
```

```bash
curl http://127.0.0.1:8787/api/health
# expect: "express":"5"

# from repo root:
node --no-warnings attack/attack.mjs http://127.0.0.1:8787 --drama
```

## Gate public deploys (recommended)

```powershell
cd server
npx wrangler secret put DEMO_GATE_TOKEN
# paste a random talk-day secret
npx wrangler deploy
```

Attack with the same token:

```bash
node --no-warnings attack/attack.mjs https://vaultpay-api.<you>.workers.dev --drama --reset --gate=YOUR_TOKEN
```

After the talk: delete the Worker or leave the gate on — see [`../TEARDOWN.md`](../TEARDOWN.md).

## Attack the live Worker

From the **repository root**:

```bash
node --no-warnings attack/attack.mjs https://vaultpay-api.<your-subdomain>.workers.dev --drama --reset
# if gated:
node --no-warnings attack/attack.mjs https://vaultpay-api.<your-subdomain>.workers.dev --drama --reset --gate=YOUR_TOKEN

# Free tier / softer load:
node --no-warnings attack/attack.mjs https://vaultpay-api.<your-subdomain>.workers.dev --drama --skip-flood --skip-slow
```

`--drama` waits for **Enter** between phases (talk control).


On corporate TLS intercept (e.g. Zscaler), Node may need:

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
```

Full runbook: [`../HOW-TO-ATTACK.md`](../HOW-TO-ATTACK.md).

## Workers probe notes

| Probe | Behavior |
| --- | --- |
| Path traversal / IDOR (Insecure Direct Object Reference) / JWT dump | Works |
| Login flood | Usually works; use `--skip-flood` if flaky |
| Large body (~1.5 MiB) | Usually works (**demo misconfig** — see below) |
| Raw TCP | Skipped (HTTPS) |
| SSRF self-fetch | May return Cloudflare `1042` (`◇ PLATFORM` — not app authz) |
| XSS probe | May return Cloudflare WAF `403` |
| In-memory DB | Resets on cold start |

## Intentional misconfig shipped to Cloudflare (not CF’s fault)

This Worker deploys the **same** vulnerable `app.js` as Vercel/Node. Three findings the attack script labels **`misconfig`** (not Express defaults, not Cloudflare inventing them):

| Knob | What we ship | Safer Express story | Attack tag |
| --- | --- | --- | --- |
| CORS | `cors({ origin: "*" })` in `app.js` | Bare Express has **no** CORS middleware | `(misconfig)` HIGH |
| Body size | `BODY_LIMIT = "50mb"` in [`wrangler.toml`](wrangler.toml) `[vars]` + custom `jsonBody` | `express.json()` default **100kb** → **413** | `(misconfig)` HIGH |
| Stack leak | `/api/boom` + error middleware return `stack` | `finalhandler` redacts stacks when `NODE_ENV=production` | `(misconfig)` MEDIUM |

**Talk honesty:** when the cloud attack log shows those three lines, blame **this repo’s app/env**, not “Workers default security is open CORS.”  
Platform-only effects (e.g. **1042**) use `◇ PLATFORM` in the terminal.

Full matrix: [`../CLOUDFLARE-VS-APP-SECURITY.md`](../CLOUDFLARE-VS-APP-SECURITY.md#whose-fault-cloud-deploy-honesty).

## Config

| File | Role |
| --- | --- |
| [`wrangler.toml`](wrangler.toml) | Worker name, flags, vars (`BODY_LIMIT`, weak `JWT_SECRET`, …), iconv alias |
| [`worker.mjs`](worker.mjs) | CF entry for Express 5 |
| [`app.js`](app.js) | Shared Express 5 app (CORS `*`, body parser, vulnerable routes) |
| [`server.js`](server.js) | Node / Azure listen entry |
| [`vfs.js`](vfs.js) | Virtual FS for path traversal |
| [`stubs/iconv-lite.js`](stubs/iconv-lite.js) | UTF-8 stub for Workers bundle |

### Why the iconv-lite stub?

Express import paths can pull `iconv-lite`, which breaks under Wrangler’s Workers bundle
(`require_streams is not a function`). This demo aliases it to a UTF-8 stub and uses a
custom JSON body reader (`jsonBody` in `app.js`).

## Optional: secret instead of `[vars]`

```bash
npx wrangler secret put JWT_SECRET
# paste: supersecret123
```

Then remove `JWT_SECRET` from `[vars]` in `wrangler.toml`.

## Logs

```bash
npm run cf:tail
```

## Azure remains supported

```bash
cd server
npm start
# PORT from Azure App Service
```

Use **either** Cloudflare Workers or Azure App Service — same Express 5 API, same attack script.
