# Deploy VaultPay Express to Cloudflare Workers

Follows Cloudflare’s official Express tutorial pattern
([Deploy an Express.js application on Cloudflare Workers](https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/)):

- `nodejs_compat` compatibility flag
- `app.listen(PORT)` + `export default httpServerHandler({ port: PORT })` from `cloudflare:node`

## Prerequisites

1. Cloudflare account (free plan is enough for the demo)
2. Node.js 18+
3. One-time login:

```bash
cd demo-attack-express/server
npm install
npx wrangler login
```

## One-command deploy

```bash
cd demo-attack-express/server
npm run deploy:cf
```

Or from the demo root:

```bash
cd demo-attack-express
npm run deploy:cf
```

Wrangler prints a URL like:

```text
https://vaultpay-api.<your-subdomain>.workers.dev
```

## Local Workers runtime (same as prod)

```bash
cd demo-attack-express/server
npm run dev:cf
# → http://127.0.0.1:8787
```

```bash
# smoke
curl http://127.0.0.1:8787/api/health

# attack (same script as Azure/local Node)
node ../attack/attack.mjs http://127.0.0.1:8787 --skip-slow
```

## Wire the React SPA

```powershell
cd demo-attack-express/client
$env:VITE_API_URL="https://vaultpay-api.<your-subdomain>.workers.dev"
npm run build
# publish client/dist/ to GitHub Pages
```

CORS is already `*` on the API, so GitHub Pages can call the Worker with no extra config.

## Attack the live Worker

```bash
node demo-attack-express/attack/attack.mjs https://vaultpay-api.<your-subdomain>.workers.dev --drama

# Free tier / softer load:
node demo-attack-express/attack/attack.mjs https://vaultpay-api.<your-subdomain>.workers.dev --skip-flood --skip-slow
```

Notes for Workers targets:

| Probe | Behavior |
| --- | --- |
| Path traversal / IDOR / JWT dump | Works (in-memory VFS + same routes) |
| Login flood | Works; may hit platform limits — use `--skip-flood` if flaky |
| Large body (~1.5 MiB) | Usually works; platform request limits still apply |
| Raw TCP header probes | Skipped automatically (HTTPS) |
| SSRF loopback | Uses the public Worker URL to re-fetch `/api/debug/config` |
| In-memory DB | Per-isolate; cold starts re-seed demo users (good for talks) |

## Config

| File | Role |
| --- | --- |
| [`wrangler.toml`](wrangler.toml) | Worker name, `nodejs_compat`, HTTP server flags, vars, iconv alias |
| [`worker.mjs`](worker.mjs) | CF entry (`httpServerHandler`) |
| [`app.js`](app.js) | Shared Express app (Node + Workers + Azure) |
| [`server.js`](server.js) | Classic Node/Azure `listen` entry |
| [`vfs.js`](vfs.js) | In-memory files (path traversal without real disk) |
| [`stubs/iconv-lite.js`](stubs/iconv-lite.js) | UTF-8 stub — Express pulls real iconv-lite and Wrangler breaks it |

### Why the iconv-lite stub?

Express still depends on `body-parser` → `iconv-lite` at import time. Under Wrangler’s
Workers bundle that currently throws `require_streams is not a function`. The demo
only needs UTF-8 JSON, so `wrangler.toml` aliases `iconv-lite` to a tiny stub.
Node / Azure use the real package as usual.

Change the Worker name in `wrangler.toml` if `vaultpay-api` is taken on your account.

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

Use **either** Cloudflare Workers (free, global edge) **or** Azure App Service for the talk — same attack script, same SPA.
