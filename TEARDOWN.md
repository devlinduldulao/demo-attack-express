# Teardown & public-deploy safety

This demo ships **intentional** open-proxy, HTML-echo, oversized-body, and slow-handler
sinks. On a public Cloudflare Workers or Vercel URL they are **scanner bait** and
abuse attributable to **your** account.

Do one of the following **before** leaving the demo live overnight, and **always**
after a conference talk.

---

## Option A — Tear down (recommended post-talk)

### Cloudflare Workers

```powershell
cd server
npx wrangler delete vaultpay-api
# or: npx wrangler delete --name vaultpay-api
```

Confirm: `https://vaultpay-api.<you>.workers.dev` returns nothing useful.

### Vercel

```powershell
cd server
# list projects if needed: vercel project ls
vercel remove vaultpay-api --yes
# or from Vercel dashboard → Project → Settings → Delete
```

### Azure App Service

Stop or delete the App Service in the portal (or `az webapp delete …`).

---

## Option B — Gate the demo (keep URL, block random scanners)

When `DEMO_GATE_TOKEN` is set, **every** request (except CORS preflight) must send:

```http
X-VaultPay-Demo: <token>
```

Missing/wrong header → `404 { "error": "Not found" }` (no free open-proxy).

### Local

```powershell
cd server
$env:DEMO_GATE_TOKEN = "talk-day-secret"
npm start
```

### Cloudflare Workers

```powershell
cd server
npx wrangler secret put DEMO_GATE_TOKEN
# paste the token when prompted
npx wrangler deploy
```

### Vercel

```powershell
cd server
vercel env add DEMO_GATE_TOKEN production
# paste value
vercel --prod --yes
```

### Attack with the gate

```powershell
$env:DEMO_GATE_TOKEN = "talk-day-secret"
# or:
node --no-warnings attack/attack.mjs https://vaultpay-api.example.workers.dev --drama --reset --gate=talk-day-secret
```

---

## Talk-day checklist

| When | Action |
| --- | --- |
| Before stage | Health check; cold-start once; gate optional if room network is trusted |
| After talk | **Tear down** or leave **gate on** with a rotated token |
| Never | Leave ungated `/api/proxy`, `/api/echo`, `/api/slow`, 50 mb body on public prod |

---

## What is still intentional on the gated demo

The gate only stops **unauthorized callers**. Once the attack script sends the header,
all intentional vulns (BOLA (Broken Object Level Authorization), mass-assign, debug secret, open proxy, …) still fire —
that is the point of the talk.
