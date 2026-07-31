# Deploy VaultPay Express 5 to Cloudflare Workers

This API is **Express 5.x** (`express@^5.2.1`, Node.js >= 18). See
[`../EXPRESS-V5.md`](../EXPRESS-V5.md), the
[Express 5 migration guide](https://expressjs.com/en/guide/migrating-5/), and the
[v5 release post](https://expressjs.com/en/blog/2024-10-15-v5-release/).

Follows Cloudflare’s official Express-on-Workers pattern
([Deploy an Express.js application on Cloudflare Workers](https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/)):

- `nodejs_compat` compatibility flag
- `app.listen(PORT)` + `export default httpServerHandler({ port: PORT })` from `cloudflare:node`

## Prerequisites

1. Cloudflare account (free plan is enough for the demo)
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

After deploy, re-run the attack against Express 5 in production:

```bash
node attack/attack.mjs https://vaultpay-api.<your-subdomain>.workers.dev --drama
```

## Local Workers runtime (same as prod)

```bash
cd server
npm run dev:cf
# → http://127.0.0.1:8787
```

```bash
curl http://127.0.0.1:8787/api/health
# expect: "express":"5"

node ../attack/attack.mjs http://127.0.0.1:8787 --skip-slow
```

## Wire the React SPA

```powershell
cd client
$env:VITE_API_URL="https://vaultpay-api.<your-subdomain>.workers.dev"
npm run build
# publish client/dist/ to GitHub Pages
```

CORS is already `*` on the API, so GitHub Pages can call the Worker with no extra config.

## Attack the live Worker

```bash
node attack/attack.mjs https://vaultpay-api.<your-subdomain>.workers.dev --drama

# Free tier / softer load:
node attack/attack.mjs https://vaultpay-api.<your-subdomain>.workers.dev --skip-flood --skip-slow
```

Notes for Workers targets:

| Probe | Behavior |
| --- | --- |
| Path traversal / IDOR / JWT dump | Works (in-memory VFS + same routes) |
| Login flood | Works; may hit platform limits — use `--skip-flood` if flaky |
| Large body (~1.5 MiB) | Usually works; platform request limits still apply |
| Raw TCP header probes | Skipped automatically (HTTPS) |
| SSRF self-fetch | May return Cloudflare `1042` (platform); open proxy route still exists |
| XSS probe | May return Cloudflare WAF `403`; Express HTML sink still present without WAF |
| In-memory DB | Per-isolate; cold starts re-seed demo users (good for talks) |

## Config

| File | Role |
| --- | --- |
| [`wrangler.toml`](wrangler.toml) | Worker name, `nodejs_compat`, HTTP server flags, vars, iconv alias |
| [`worker.mjs`](worker.mjs) | CF entry (`httpServerHandler`) for Express 5 app |
| [`app.js`](app.js) | Shared Express **5** app (Node + Workers + Azure) |
| [`server.js`](server.js) | Classic Node/Azure `listen` entry (v5 error callback) |
| [`vfs.js`](vfs.js) | In-memory files (path traversal without real disk) |
| [`stubs/iconv-lite.js`](stubs/iconv-lite.js) | UTF-8 stub — Express body stack + Wrangler |

### Why the iconv-lite stub?

Express still depends on code paths that pull `iconv-lite` at import time. Under Wrangler’s
Workers bundle that currently throws `require_streams is not a function`. The demo
only needs UTF-8 JSON, so `wrangler.toml` aliases `iconv-lite` to a tiny stub.
Node / Azure use the real package as usual. Body parsing uses a custom stream reader
(`jsonBody` in `app.js`) instead of `express.json()` on Workers.

## Optional: secret instead of plain `[vars]`

The demo intentionally ships a weak secret in `[vars]`. For a slightly less embarrassing (still insecure) setup:

```bash
npx wrangler secret put JWT_SECRET
# paste: supersecret123
```

Then remove `JWT_SECRET` from the `[vars]` block in `wrangler.toml`.

## Logs

```bash
npm run cf:tail
```

## Azure remains supported

Nothing was removed. Classic Node still runs with:

```bash
npm start
# PORT from Azure App Service
```

Use **either** Cloudflare Workers (free, global edge) **or** Azure App Service for the talk — same Express 5 app, same attack script, same SPA.
