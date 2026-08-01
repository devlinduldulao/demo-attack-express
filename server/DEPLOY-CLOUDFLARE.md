# Deploy VaultPay Express 5 to Cloudflare Workers

This API is **Express 5.x** (`express@^5.2.1`, Node.js >= 18). See
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
node attack/attack.mjs http://127.0.0.1:8787
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
node attack/attack.mjs https://vaultpay-api.<you>.workers.dev --gate=YOUR_TOKEN
```

After the talk: delete the Worker or leave the gate on — see [`../TEARDOWN.md`](../TEARDOWN.md).

## Attack the live Worker

From the **repository root**:

```bash
node attack/attack.mjs https://vaultpay-api.<your-subdomain>.workers.dev
# if gated:
node attack/attack.mjs https://vaultpay-api.<your-subdomain>.workers.dev --gate=YOUR_TOKEN

# Free tier / softer load:
node attack/attack.mjs https://vaultpay-api.<your-subdomain>.workers.dev --skip-flood --skip-slow
```


On corporate TLS intercept (e.g. Zscaler), Node may need:

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
```

Full runbook: [`../HOW-TO-ATTACK.md`](../HOW-TO-ATTACK.md).

## Workers probe notes

| Probe | Behavior |
| --- | --- |
| Path traversal / IDOR / JWT dump | Works |
| Login flood | Usually works; use `--skip-flood` if flaky |
| Large body (~1.5 MiB) | Usually works |
| Raw TCP | Skipped (HTTPS) |
| SSRF self-fetch | May return Cloudflare `1042` |
| XSS probe | May return Cloudflare WAF `403` |
| In-memory DB | Resets on cold start |

## Config

| File | Role |
| --- | --- |
| [`wrangler.toml`](wrangler.toml) | Worker name, flags, vars, iconv alias |
| [`worker.mjs`](worker.mjs) | CF entry for Express 5 |
| [`app.js`](app.js) | Shared Express 5 app |
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
