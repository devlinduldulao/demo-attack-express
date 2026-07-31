# Talk scripts — JWT ≠ Secure API

Two scripts live here:

| Slot | Use |
| --- | --- |
| **[5 minutes](#5-minute-lightning)** | Lightning / hostile room / backup |
| **[30–45 minutes](#30--45-minute-conference)** | Conference default — **this is the real talk** |

**Thesis you can defend end-to-end:**

> JWT is not a security model. Your framework gives you almost nothing —
> and nothing is not a security model.

**Not** the thesis: “Express is insecure by default on body limits / CORS / stacks.”
Those three are **misconfig** in *this* demo (see [Honest labels](#honest-labels)).

---

## Projector order

| Screen | What | File / command |
| --- | --- | --- |
| 1 | Frame + health | browser / `GET /api/health` |
| 2 | **Terminal** (primary visual) | `node attack/attack.mjs URL --drama` |
| 3 | Edge vs app (short bullets, not a markdown table dump) | key lines from [`CLOUDFLARE-VS-APP-SECURITY.md`](CLOUDFLARE-VS-APP-SECURITY.md) |
| 4 | Same code, two clouds | [`PLATFORM-COMPARISON.md`](PLATFORM-COMPARISON.md) |
| 5 | Close | 4 lines on slide or spoken |

Do **not** paste full markdown tables on the projector. Terminal = visual; slides = framing.

---

## Honest labels

On-screen findings are tagged:

| kind | Meaning | Audience line |
| --- | --- | --- |
| `framework-gap` | Express does not provide this control | “Nothing in the box” |
| `misconfig` | Junior replaced a *safer* Express default | “We weakened what Express already gave” |
| `junior-code` | App code you wrote wrong | “Tutorial shipped this” |
| `◇ PLATFORM` | Edge/runtime blocked the probe | “CDN ≠ authz” |

Three findings that used to overstate Express defaults (fixed in the script):

| Finding | Honest story |
| --- | --- |
| Oversized body ~1.5 MiB | **misconfig** — `express.json()` defaults to **100 kb**. Demo uses custom ~50 mb parser. |
| Stack traces | **misconfig** — Express `finalhandler` redacts stacks when `NODE_ENV=production`. Custom handler leaks on purpose. |
| CORS `*` | **misconfig** (tests only) — bare Express has **no** CORS; junior added `cors` + `origin: "*"`. |

**Real Express gaps that still land hard:** no secure headers, `x-powered-by` ON, no rate limit, no request timeout, no authz primitive, no response schema / field allowlist, no SSRF helper.

---

## Setup (before audience)

```powershell
cd server
# Prefer gate on public deploys:
# npx wrangler secret put DEMO_GATE_TOKEN
# vercel env add DEMO_GATE_TOKEN production
npx wrangler deploy   # or vercel --prod --yes
cd ..

# Zscaler laptop only:
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
# If gated:
$env:DEMO_GATE_TOKEN = "talk-day-secret"
```

Warm the cold start:

```powershell
Invoke-RestMethod https://vaultpay-api.devlinduldulao.workers.dev/api/health
# second cloud if you will compare:
Invoke-RestMethod https://vaultpay-api.vercel.app/api/health
```

After the talk: **[TEARDOWN.md](TEARDOWN.md)** — delete projects or leave the gate on.

---

# 5-minute lightning

## 0:00–0:45 — Frame

**Show:** `GET /api/health` → `"express":"5"`.

**Say:**

> “Junior tutorial: Express 5, JWT login, free Cloudflare. They think modern stack + JWT + CDN = done.”

Optional: show a login that returns a Bearer token — “Login works. Feels finished.”

## 0:45–3:30 — Attack

```powershell
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama
# if gated: add --gate=talk-day-secret
```

`--drama` waits for **Enter** — you control the beat. Narrate only the scares:

| When you see… | Say… |
| --- | --- |
| Path LOOT `JWT_SECRET` | “No password. Public files → secrets.” |
| User dump cards / SSN | “Still no token. Every customer.” |
| BOLA orders | “Alice’s JWT reads everyone’s transfers.” |
| Mass-assign admin | “We PUT `role: admin`. JWT never stopped it.” |
| Forged admin | “We stopped needing their password.” |
| `◇ PLATFORM` | “That’s the edge — not the app learning authz.” |
| `(misconfig)` body/stack | “We weakened Express here on purpose — not a default.” |

## 3:30–4:30 — Edge one-liner

> “Cloudflare blocked the noisy XSS string and Worker self-fetch. It did **not** stop the card dump or the forged admin. Edge filters are not API authorization.”

## 4:30–5:00 — Close

1. Authn ≠ authz.  
2. JWT is one control, not a security model.  
3. Frameworks give you almost nothing — ship defaults + ownership checks.  
4. Only attack systems you own. Tear down when done.

Optional 30s product note (do **not** pitch during the run): secure-default frameworks exist; ownership rules are still yours.

---

# 30–45 minute conference

## Arc (keep this shape)

| Block | Time | Goal |
| --- | --- | --- |
| Frame + JWT myth | 0–5 min | Thesis on the wall |
| Live attack (CF or local) | 5–18 min | Scoreboard; Enter; **forgery is last phase** |
| What is / isn’t a default | 18–23 min | Disarm the skeptic |
| **Green run** (`HARDENED=1`) | 23–28 min | Same script → 0 critical — kills “product ad” read |
| **Same code, two clouds** | 28–38 min | Differentiator — expand this |
| Close + Q&A | 38–45 min | Framework note last 30s only |

If the slot is **~30 min**, keep green run + drop one cloud. If **5 min**, skip green run and clouds.

---

## 0:00–5:00 — Frame

**Slide (max 5 bullets):**

- Tutorial: Express + JWT + “secure”
- Deployed: Cloudflare / Vercel free tier
- Claim: “We have authentication”
- Question: is the **API** secure?
- Thesis line (yellow): *nothing is not a security model*

**Demo:** health + optional login. Do **not** open a SPA — there isn’t one.

**Say:**

> “This is a black-box attacker against a real URL. No frontend to break. Same code on two clouds later.”

---

## 5:00–20:00 — Live attack (primary visual)

```powershell
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama --projector --reset --gate=YOUR_TOKEN
```

**How to use Enter:** finish the sentence, then press Enter. If the room is reading, wait.

**Climax order:** settings + raw TCP finish *before* BOLA/mass-assign/forged JWT so the last LOOT is the forged admin — not “Skipped raw TCP on HTTPS.”

### Phase narration map (OWASP API Top 10)

| Phase (approx) | OWASP | Line |
| --- | --- | --- |
| Missing headers / `X-Powered-By` | API8 | “Framework gap — zero secure headers out of the box.” |
| Oversized body | API4 | “**misconfig** — Express defaults 100 kb; we raised it.” |
| Login flood, no 429 | API4 | “No rate limit primitive in Express.” |
| Path traversal → secret | API1 | “Junior file server. Not Express inventing VFS.” |
| Open redirect | API8 | “`res.redirect(user input)`.” |
| Open proxy / SSRF | API7 | “Junior `fetch(url)`. Edge may block self-fetch — still an open proxy.” |
| Stack + HTML echo | API8 | “Stack = misconfig; XSS sink = junior code.” |
| Slow handler | API4 | “No request timeout in the framework.” |
| User dump / IDOR / debug | API1, API3, API8 | “JWT thesis — no password.” |
| Account enum | API2 | “Different login errors.” |
| BOLA orders | API1 | “Authn without authz.” |
| Mass assign / cross-user | API3, API1 | “Raw JSON into user row.” |
| Admin stats | API5 | “requireAuth ≠ requireRole (BFLA).” |
| Forged JWT | API2 | “Secret leak → identity forge.” |
| Settings PUT | API3 | “Unauth state change.” |

**Scoreboard tension:** call out critical count rising. Pause hard after first LOOT of cards and after forged admin.

**Daloy / product:** **zero mentions** during this block. Console no longer pitches per phase.

---

## 23:00–28:00 — Green run (plain Express fixed)

**Why:** the room just watched red. Show the same script go quiet.

```powershell
# Local one-liner, or a second hardened Worker URL
npm run demo:hardened
# or:
# HARDENED=1 on a second deploy, then:
# node attack/attack.mjs https://vaultpay-api-hardened… --quiet
```

**Say:**

> “Same Express 5. Ownership checks, field allowlist, requireRole, 100 kb body, headers, no debug surface. Attack script: **0 critical**. You can fix this without buying a framework. A framework that *starts* here is optional insurance for juniors.”

Do **not** name a product until the last 30 seconds of the close.

---

## 18:00–23:00 — Disarm the skeptic (defaults vs junior)

**Say:**

> “Someone in row three knows Express. Good. Three things on older slides *looked* like defaults and weren’t.”

Whiteboard or one slide:

| Claim that loses the room | Truth |
| --- | --- |
| “Express accepts 1.5 MiB bodies” | Default is **100 kb**. We used a custom 50 mb parser. |
| “Express leaks stacks in prod” | **finalhandler** redacts when `NODE_ENV=production`. |
| “Express CORS allows *” | Express ships **no** CORS. We added the package. |

Then:

> “Express’s defaults are fine where they exist. The problem is **how few of them exist.**”

List (framework-gap, undisputable):

- No secure headers; `x-powered-by: Express` on  
- No rate limiting  
- No request timeout  
- No authz / role primitive  
- No response schema / mass-assign guard  
- No SSRF / safe-redirect helper  

> “JWT thesis stands on its own: unauth dump, IDOR, BOLA, mass-assign, BFLA, forged token. Nobody argues with that chain.”

---

## 25:00–35:00 — Same code, two clouds (your differentiator)

This is the **original** material most “JWT isn’t enough” talks lack. Give it **~10 minutes**.

**Setup:** pre-run or live second target.

```powershell
# Cloudflare study (already on screen or open ATTACK-RUN-CLOUDFLARE.md)
# Vercel:
node attack/attack.mjs https://vaultpay-api.vercel.app --drama --skip-flood
```

**Story structure (not a 17-row table on screen):**

1. **Same app source** — Express 5, intentional vulns, both live.  
2. **Different edge behavior** — CF may 1042 self-SSRF and WAF-block noisy XSS; Vercel may differ on headers/HSTS/flood.  
3. **Same pwn** — user dump, BOLA, mass-assign, forged admin still land on **both**.  
4. **Punchline:** platform notes are `◇ PLATFORM`. App holes are `✗ APP HOLE`. Do not conflate them.

**Say:**

> “If you only remember one thing from the cloud comparison: the CDN can change which *probes* fail, not whether your *authorization* works.”

Point people at [`PLATFORM-COMPARISON.md`](PLATFORM-COMPARISON.md) and the two ATTACK-RUN studies for after the talk — do not read tables aloud.

---

## 35:00–40:00 — Close

**Four lines (slide or spoken):**

1. **Authn ≠ authz.** A valid JWT is not an access-control policy.  
2. **JWT is one control.** Secret leak + HS256 = forged identity.  
3. **Nothing is not a security model.** Frameworks that ship almost no defaults leave juniors shipping open APIs.  
4. **Edge ≠ API security.** Same code, two clouds, both pwned where it counts.

**Last 30 seconds only (optional product / framework note):**

> “If you want a stack that *fails closed* on body limits, headers, rate limits, and schemas by default — that’s why secure-by-default frameworks exist. They still won’t invent your ownership rules. You write `order.userId === req.user.sub`.”

Do **not** open a 17-row feature matrix. Link README later.

**Ethics:**

> “Only systems you own. We’re tearing this down after the talk.” → [TEARDOWN.md](TEARDOWN.md)

---

## 40:00–45:00 — Q&A prompts you can answer

| Question | Answer |
| --- | --- |
| “Isn’t this just bad code?” | Yes for traversal/proxy/debug — labelled `junior-code`. JWT/BOLA/BFLA chain is the thesis. |
| “Express 5 fixed security?” | No — v5 is API cleanup, not a security model. |
| “Would helmet / rate-limit fix it?” | Partly transport; not BOLA/ownership. |
| “Cloudflare failed?” | No — edge did its job on two probes; app authz still missing. |
| “Why 50 mb body?” | Demo honesty: Workers + attack need it; labelled misconfig. |

---

## Hostile / 2-minute backup

1. Health → express 5  
2. `node attack/attack.mjs URL` **without** `--drama`  
3. Jump to LOOT users + JWT_SECRET + DEMO RESULT  
4. One line: Cloudflare ≠ authz; JWT ≠ security model  

---

## What makes this demo work

| Strength | Why it lands |
| --- | --- |
| Unauth PII first | Gasp before “login” |
| `✗ APP HOLE` vs `◇ PLATFORM` | Prevents edge misread |
| BOLA + forge chain | JWT myth dies on screen |
| CF vs Vercel same app | Differentiator |
| kind + OWASP tags | Authority with security-literate audience |
| Enter-driven `--drama` | You talk; they read |

## What not to claim

- Free Cloudflare has “no protection” (it blocked probes)  
- Express defaults allow 50 mb bodies / open CORS / prod stacks (they don’t)  
- A framework invents your ownership rules for free  
- Product pitch during every phase (close only)
