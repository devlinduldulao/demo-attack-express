# Express 5 in this demo

This folder targets **Express 5**, not Express 4.

| Reference | URL |
| --- | --- |
| npm package | https://www.npmjs.com/package/express |
| Migrating to Express 5 | https://expressjs.com/en/guide/migrating-5/ |
| v5 release announcement | https://expressjs.com/en/blog/2024-10-15-v5-release/ |

Pinned range in [`server/package.json`](server/package.json):

```json
"express": "^5.2.1"
```

Install (from `server/`):

```bash
npm install "express@5"
# or
npm install
```

**Runtime requirement:** Node.js **>= 18** (Express 5 dropped older Node).

---

## Why upgrade the demo to v5?

Tutorials still ship “Express + JWT” without authz. Using **current** Express avoids the false comfort of “we’re on old Express, that’s the problem.” The holes in this demo are **application design**, not “because Express 4 is ancient.”

Express 5 is intentionally a **boring** major: better security baseline in the framework, path-to-regexp hardening, promise rejection forwarding, body-parser updates — **not** automatic rate limits, ownership checks, or secure headers for your bank API.

---

## Migration points that apply to VaultPay

From the [official guide](https://expressjs.com/en/guide/migrating-5/) and [release notes](https://expressjs.com/en/blog/2024-10-15-v5-release/), what we touched or already complied with:

| Express 5 change | VaultPay status |
| --- | --- |
| Node.js >= 18 (Express 5) | This package pins `engines.node: ">=24"` |
| `res.status(n).json(...)` only (no `res.json(obj, status)`) | Already used throughout `app.js` |
| `res.redirect(status, url)` order | `res.redirect(302, url)` on `/api/go` |
| `req.body` default is `undefined` (not `{}`) | Handlers use `req.body \|\| {}`; custom JSON middleware documents this |
| Path params: named only; no `/:id(\\d+)` regex | Routes use plain `:id` |
| Wildcards need names (`/*splat`) | No wildcard routes |
| `app.del` removed | Not used (`DELETE` not needed) |
| `req.param(name)` removed | Not used |
| `app.listen` callback receives `error` | [`server.js`](server/server.js) checks the error arg |
| Rejected promises in async handlers → error middleware | Compatible; error middleware still leaks stacks (intentional) |
| `express.urlencoded({ extended })` default `false` | We do not use urlencoded; custom JSON only |
| body-parser depth / security fixes | N/A for custom parser; Node path can use `express.json()` if not on Workers |

---

## Cloudflare Workers note + body-limit honesty

`express.json()` still pulls code that breaks under Wrangler’s Workers bundle (`iconv-lite` / `require_streams`). This demo keeps a **custom stream JSON parser** with a huge limit (~50 mb) so:

1. Express 5 works on Workers
2. The oversized-body attack still demos

**Talk honesty:** Express 5 `express.json()` defaults to **100 kb** and returns **413**. The 1.5 MiB acceptance on screen is a **demo misconfig** (we replaced the safer default), **not** an Express default. The attack script labels it `misconfig` / API4. Same for production stack leaks (custom error handler vs `finalhandler` redaction) and CORS `*` (added `cors` package — bare Express has no CORS).

Real Express **gaps** that remain fair to claim: no secure headers, `x-powered-by` ON, no rate limit, no request timeout, no authz primitive, no response schema.

See `jsonBody()` in [`server/app.js`](server/app.js) and the `iconv-lite` alias in [`server/wrangler.toml`](server/wrangler.toml).

---

## Attack script

[`attack/attack.mjs`](attack/attack.mjs) is HTTP black-box. It does not import Express. After the upgrade it still targets the same routes; comments/banner state the target is **Express 5**.

---

## Verify

```bash
cd server
npm install
npm start
# other terminal (repo root):
node attack/attack.mjs http://localhost:4000 --reset --skip-slow
```

Optional codemods (upstream; we already match v5 style):

```bash
npx codemod@latest @expressjs/v5-migration-recipe
```

---

## Talk sound bite

> “Upgrading from Express 4 to Express 5 is good hygiene. It does **not** mean your REST API is authorized. JWT still only proves a login happened if you wire it that way — and this app still dumps every card number without a token.”
