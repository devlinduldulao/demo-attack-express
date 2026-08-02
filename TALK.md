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

**Also not the thesis:** “Cloudflare / Vercel defaults are open CORS and 50 mb bodies.”
Those ship in **our** `app.js` / `BODY_LIMIT` on every host (see [Terminal: whose fault](#terminal-whose-fault-on-cloud-runs)).

---

## Projector order (~40 min)

**Rule:** terminal is still the hero (~15 min continuous). Slides frame and close; they do not re-run the attack in bullet form.

| # | When | Slide title | On screen (keep sparse) | Say in one line |
| --- | --- | --- | --- | --- |
| 1 | 0:00 | Title / thesis | *JWT ≠ secure API* · *nothing is not a security model* | “Tutorial stack + cloud ≠ security model.” |
| 2 | 0:02 | What we’re attacking | Black-box API · Express 5 + JWT · no SPA · live URL | “No frontend to hack. Hit the API URL.” |
| 3 | ~0:04 | **How to read the terminal** | See [Legend slide](#legend-slide-how-to-read-the-terminal) below | “Demo scoring + loot — not CVSS.” |
| 4 | 0:05–20 | *(leave up or black)* | **Terminal** is primary | `--drama --projector --reset` |
| 5 | ~12–15 | Authn ≠ authz (optional mid-attack) | Login = who · Authz = what you’re allowed to touch · BOLA/IDOR | After first JWT loot / user dump — 20s then back to terminal |
| 6 | 20:00 | Honest labels | `framework-gap` · `misconfig` · `app-code` · `◇ PLATFORM` | “Don’t blame Express for what we weakened.” |
| 7 | 20:30 | Defaults vs incomplete setup | 3 false claims → truth (body / stack / CORS) | Disarm the skeptic |
| 8 | 22:00 | What Express still doesn’t ship | 5–6 bullets: headers, rate limit, timeout, authz, schema, SSRF helper | “Defaults fine where they exist; few exist.” |
| 9 | 25:00 | Same code, two clouds | Diagram: one `app.js` → CF / Vercel · both pwned | “CDN changes probes, not authz.” |
| 10 | 28:00 | Edge ≠ API security | CF 1042 / HSTS vs unauth PII + forge | “Platform blocked a probe; cards still dumped.” |
| 11 | 32:00 | Whose fault? | misconfig = us · gap = Express empty box · app-code = routes · PLATFORM = edge | Match report **Whose fault?** block |
| 12 | 35:00 | Close (5 lines) | Authn≠authz · JWT one control · nothing≠model · edge≠API · misconfig is us | No product pitch until last 30s |
| 13 | 38:00+ | Q&A / resources | Repo · TEARDOWN · only systems you own | Gate or tear down after |

**Do not add:** full OWASP Top 10 deck, 17-row finding dump, product comparison matrix, multi-slide CVSS lecture.

Do **not** paste full markdown tables from the studies on the projector. Terminal = visual; slides = framing.

### Legend slide (how to read the terminal)

Use **before** Enter-driven attack, or flash when the first scoreboard appears.

| On screen | Means |
| --- | --- |
| `→ SEND` / `← RECV` | Wire request / response |
| `LOOT` | Data we extracted this run |
| `✗ APP HOLE` | App/demo weakness (read the kind tag) |
| `◇ PLATFORM` | Edge/runtime blocked a **probe** — not “API is secure” |
| `✓ OK` | This probe did not fire / expected fail-closed |
| Scoreboard critical / high / medium / info | **Demo severity** (script authors) — **not CVSS**, not a scanner product |
| loot users / orders / secret | Evidence counters in `stolen` state |
| `(framework-gap)` | Express does not ship this control |
| `(misconfig)` | **Our** app/env weakened a safer default |
| `(app-code)` | Vulnerable route logic you wrote |

**Spoken (10s):**  
> “Severities are our labels for the talk. Loot is what we actually stole. Kind tags say whose fault.”

---

## Honest labels

On-screen findings are tagged:

| kind | Meaning | Audience line |
| --- | --- | --- |
| `framework-gap` | Express does not provide this control | “Nothing in the box” |
| `misconfig` | **Our** demo app/env replaced a *safer* Express default | “We weakened it — not Express, not the cloud” |
| `app-code` | Vulnerable route / app logic you wrote | “Tutorial shipped this” |
| `◇ PLATFORM` | Edge/runtime blocked the probe | “CDN ≠ authz” |

### IDOR vs BOLA (say this once if someone freezes)

| Term | Plain English | This demo |
| --- | --- | --- |
| **IDOR** | “I change the id in the URL and get someone else’s record.” | `GET /api/users/2` with no (or wrong) token |
| **BOLA** | OWASP API1 name for the same class — object-level authz missing | Alice’s JWT → `GET /api/orders` returns **all** customers’ orders |
| **BFLA** | Function/role-level authz missing | Any JWT hits admin stats |

**One line for the room:** *Login proves who you are. IDOR/BOLA is failing what you’re allowed to touch.*

Three findings that used to overstate Express defaults (fixed in the script) — **same lines on CF, Vercel, and localhost**:

| Finding | Honest story | Not whose fault |
| --- | --- | --- |
| Oversized body ~1.5 MiB | **misconfig** — `express.json()` defaults to **100 kb**. Demo uses custom ~50 mb parser (`BODY_LIMIT`). | Express default · CF/Vercel “platform body policy” |
| Stack traces | **misconfig** — Express `finalhandler` redacts stacks when `NODE_ENV=production`. Custom handler leaks on purpose. | Express prod default · the host |
| CORS `*` | **misconfig** — bare Express has **no** CORS; this app added `cors` + `origin: "*"`. | Bare Express · Cloudflare / Vercel inventing open CORS |

**Real Express gaps that still land hard:** no secure headers, `x-powered-by` ON, no rate limit, no request timeout, no authz primitive, no response schema / field allowlist, no SSRF helper.

---

## Terminal: whose fault on cloud runs

After the attack finishes, the script prints a **Whose fault?** block (and a **Misconfig detail** list). Use it on stage — do not invent blame.

**What you should see (counts from the 2026-08-01 cloud engagements; re-run if the app changes):**

```text
By kind         {"framework-gap":4,"misconfig":3,"app-code":16}

Whose fault? (read the kind tag on every finding):
  (misconfig)     3 — this demo's app/deploy vars (CORS *, BODY_LIMIT ~50mb, stack leak).
                   Not Express defaults. Not Cloudflare/Vercel inventing them.
  (framework-gap) 4 — Express does not ship the control (headers, rate limit, timeout, …).
  (app-code)     16 — vulnerable routes you wrote (BOLA, proxy, traversal, debug, …).
  ◇ PLATFORM      N — edge/runtime blocked a probe; does not mean the API is authorized.

Misconfig detail (cloud hosts still show these — same app.js):
  [HIGH] [API8] (misconfig) CORS misconfig allows any browser origin
  [HIGH] [API4] (misconfig) Demo misconfig: custom parser allows ~50mb bodies
  [MEDIUM] [API8] (misconfig) Misconfig: custom error handler leaks stack in production
```

| If someone says… | You point at… | You say… |
| --- | --- | --- |
| “Cloudflare is insecure” | `(misconfig)` ×3 **same on Vercel** | “Those three are our deploy. Edge is `◇ PLATFORM` only.” |
| “Express allows 50 mb / open CORS” | misconfig detail lines | “Safer defaults exist; we replaced them — tag is `misconfig`.” |
| “The CDN protected us” | `◇ PLATFORM` vs critical `app-code` | “Filtered a probe. Cards and forge still landed.” |

**Capture fresh logs** (files are gitignored — regenerate before a talk if you want handouts):

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"   # Zscaler only if needed
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --reset --json *> ATTACK-RUN-CLOUDFLARE-LATEST.log
node attack/attack.mjs https://vaultpay-api.vercel.app --reset --json *> ATTACK-RUN-VERCEL-LATEST.log
```

Studies that already document the three misconfigs on each cloud:  
[`ATTACK-RUN-CLOUDFLARE.md`](ATTACK-RUN-CLOUDFLARE.md) · [`ATTACK-RUN-VERCEL.md`](ATTACK-RUN-VERCEL.md) ·  
full matrix: [`CLOUDFLARE-VS-APP-SECURITY.md`](CLOUDFLARE-VS-APP-SECURITY.md#whose-fault-cloud-deploy-honesty).

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

> “Tutorial stack: Express 5, JWT login, free Cloudflare. They think modern stack + JWT + CDN = done.”

Optional: show a login that returns a Bearer token — “Login works. Feels finished.”

## 0:45–3:30 — Attack

```powershell
node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama --reset
# if gated: add --gate=talk-day-secret
```

`--drama` waits for **Enter** between phases so you control the beat.

| When you see… | Say… |
| --- | --- |
| Path LOOT `JWT_SECRET` | “No password. Public files → secrets.” |
| User dump cards / SSN | “Still no token. Every customer.” |
| BOLA orders | “Alice’s JWT reads everyone’s transfers.” |
| Mass-assign admin | “We PUT `role: admin`. JWT never stopped it.” |
| Forged admin | “We stopped needing their password.” |
| `◇ PLATFORM` (e.g. CF 1042) | “That’s the edge — not the app learning authz.” |
| `(misconfig)` body / stack / CORS | “We weakened this in the demo app — not Express, not Cloudflare.” |
| Report **Whose fault?** | “Three misconfigs are us; gaps are Express empty box; pwn is app-code.” |

## 3:30–4:30 — Edge one-liner

> “Cloudflare blocked Worker self-fetch (1042). It did **not** stop the card dump or the forged admin. Edge filters are not API authorization. Open CORS and 50 mb bodies on this Worker URL are **our** `app.js` / `BODY_LIMIT` — same tags if we deploy to Vercel.”

## 4:30–5:00 — Close

1. Authn ≠ authz.  
2. JWT is one control, not a security model.  
3. Frameworks give you almost nothing — ship defaults + ownership checks.  
4. `(misconfig)` on a cloud URL is still **our** app/env — not the host’s security product.  
5. Only attack systems you own. Tear down when done.

Optional 30s product note (do **not** pitch during the run): secure-default frameworks exist; ownership rules are still yours.

---

# 30–45 minute conference

## Arc (keep this shape)

| Block | Time | Goal |
| --- | --- | --- |
| Frame + JWT myth | 0–5 min | Thesis on the wall |
| Live attack (CF or local) | 5–20 min | Scoreboard; Enter; **forgery is last phase** |
| What is / isn’t a default | 20–25 min | Disarm the skeptic (misconfig vs real gaps) |
| **Same code, two clouds** | 25–38 min | Differentiator — expand this |
| Close + Q&A | 38–45 min | What proper setup means (spoken, not a second mode) |

If the slot is **~30 min**, drop one cloud. If **5 min**, skip clouds.

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
# Prefer Vercel or CF — both full climax (9–10 critical, forge YES on latest run)
node attack/attack.mjs https://vaultpay-api.vercel.app --drama --projector --reset
# or CF:
# node attack/attack.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama --projector --reset
# if gated: add --gate=YOUR_TOKEN
```

Local one-shot (API + optional SSRF stand-in):

```powershell
npm run demo          # shorter (--skip-flood)
npm run demo:full     # full flood + internal SSRF stand-in
```

**How to use Enter:** finish the sentence, then press Enter. If the room is reading, wait.

**Climax order:** settings + raw TCP (skipped on HTTPS) finish *before* BOLA / mass-assign / forge so the last LOOT is the forged admin.

### Phase narration map (matches current `attack.mjs`)

| Phase (approx) | OWASP | Line |
| --- | --- | --- |
| Missing headers / `X-Powered-By` | API8 | “Framework gap — zero secure headers out of the box.” |
| CORS `*` | API8 | “**misconfig** — we added open CORS; Express ships none.” |
| Oversized body | API4 | “**misconfig** — Express `json()` is 100 kb; we raised it.” |
| Login flood, no 429 | API4 | “No rate limit primitive in Express.” |
| Path traversal → secret | API1 | “File endpoint with no jail.” |
| Open redirect | API8 | “`res.redirect(user input)`.” |
| Open proxy / SSRF | API7 | “`fetch(user URL)`. CF may 1042 self-fetch; open proxy still real.” |
| IMDS-class URL | API7 | “No egress allowlist — class matters even when cloud has no IMDS.” |
| Stack + HTML echo | API8 | “Stack = misconfig; XSS sink = app code.” |
| Slow handler | API4 | “No request-timeout middleware.” |
| User dump / IDOR / debug | API1, API3, API8 | “JWT thesis — no password.” |
| Account enum | API2 | “Different login errors.” |
| Settings PUT | API3 | “Unauth state change.” |
| BOLA orders | API1 | “Authn without authz.” |
| Mass assign / cross-user | API3, API1 | “Raw JSON into user row.” |
| Admin stats | API5 | “requireAuth ≠ requireRole (BFLA).” |
| **`alg:none` — rejected** | API2 | “Library saved you — not app design.” |
| Forged JWT | API2 | “Secret leak → identity forge.” |

**Scoreboard tension:** call out critical count rising. Pause hard after first LOOT of cards and after forged admin.

### Beats worth rehearsing

**`alg:none`.** Let it go green. *“You did not configure that. jsonwebtoken v9 pins HS256 for string secrets — a maintainer decided it for you.”*

**Cloud-only path:** you will **not** see the internal SSRF pivot / redirect hop unless you run local with `--internal` / `npm run demo:full`. On CF/Vercel, teach SSRF with self/external/IMDS-class + platform notes.

**Optional local SSRF pivot** (`npm run demo:full`): say the laptop caveat once — shared host, so the stand-in is reachable from the attacker machine too; the mechanic is still “server fetches URL you chose.”

**Product:** **zero mentions** during the attack block.

---

## 20:00–25:00 — Disarm the skeptic (defaults vs incomplete setup)

**Say:**

> “Someone in row three knows Express. Good. Three things on older slides *looked* like defaults and weren’t.”

Whiteboard or one slide:

| Claim that loses the room | Truth |
| --- | --- |
| “Express accepts 1.5 MiB bodies” | Default is **100 kb**. We used a custom 50 mb parser (`BODY_LIMIT` on CF/Vercel too). |
| “Express leaks stacks in prod” | **finalhandler** redacts when `NODE_ENV=production`. |
| “Express CORS allows *” | Express ships **no** CORS. We added the package. |
| “Cloudflare/Vercel set open CORS / 50 mb” | **No** — same `(misconfig)` ×3 on both hosts from **our** app. Platform only changes `◇ PLATFORM` probes. |

Then:

> “Express’s defaults are fine where they exist. The problem is **how few of them exist.** And when we *do* weaken a safer default, the terminal tags it `misconfig` so we don’t smear the framework or the cloud.”

List (framework-gap, undisputable):

- No secure headers; `x-powered-by: Express` on  
- No rate limiting  
- No request timeout  
- No authz / role primitive  
- No response schema / mass-assign guard  
- No SSRF / safe-redirect helper  

> “JWT thesis stands on its own: unauth dump, IDOR, BOLA, mass-assign, BFLA, forged token. Nobody argues with that chain.”

**If the report is still on screen:** scroll to **Whose fault?** and read the three misconfig titles out loud once (see [Terminal: whose fault](#terminal-whose-fault-on-cloud-runs)).

---

## 25:00–35:00 — Same code, two clouds (your differentiator)

This is the **original** material most “JWT isn’t enough” talks lack. Give it **~10 minutes**.

**Setup:** pre-run or live second target.

```powershell
# Cloudflare study (already on screen or open ATTACK-RUN-CLOUDFLARE.md)
# Vercel (latest: 10 critical · forge YES):
node attack/attack.mjs https://vaultpay-api.vercel.app --drama --reset --skip-flood
```

**Latest engagement (2026-08-01):** CF **9** critical / 4.3s · Vercel **10** critical / 10.1s · both forged admin. (+1 on Vercel = self-SSRF of debug secret.)

**Whose fault on both URLs (say once while the report’s kind counts are up):**

| Terminal tag | Same on CF + Vercel? | Line |
| --- | --- | --- |
| `(misconfig)` ×3 | **Yes** — CORS `*`, 50mb body, stack leak | “That’s our `app.js` / `BODY_LIMIT` — not Workers, not Vercel, not Express inventing open CORS.” |
| `(framework-gap)` | Yes | “Express never shipped rate limit / Helmet.” |
| `(app-code)` | Yes | “Tutorial routes — ownership is on us.” |
| `◇ PLATFORM` | **Differs** (e.g. CF 1042) | “Edge filtered a probe. Authz still dead.” |

Full matrix: [`CLOUDFLARE-VS-APP-SECURITY.md`](CLOUDFLARE-VS-APP-SECURITY.md#whose-fault-cloud-deploy-honesty). The attack report now prints a **Whose fault?** block before the full finding list.

**Story structure (not a 17-row table on screen):**

1. **Same app source** — Express 5, intentional vulns, both live.  
2. **Different edge behavior** — CF **1042** on self-SSRF; Vercel self-proxy returns secret; IMDS empty on both.  
3. **Same pwn** — user dump, BOLA, mass-assign, forged admin on **both**.  
4. **Punchline:** `◇ PLATFORM` vs `✗ APP HOLE`. Do not conflate them.

**Say:**

> “If you only remember one thing from the cloud comparison: the CDN can change which *probes* fail, not whether your *authorization* works.”

Point people at [`PLATFORM-COMPARISON.md`](PLATFORM-COMPARISON.md) and the two ATTACK-RUN studies for after the talk — do not read tables aloud.

---

## 35:00–40:00 — Close

**Five lines (slide or spoken):**

1. **Authn ≠ authz.** A valid JWT is not an access-control policy.  
2. **JWT is one control.** Secret leak + HS256 = forged identity.  
3. **Nothing is not a security model.** Frameworks that ship almost no defaults leave teams shipping open APIs.  
4. **Edge ≠ API security.** Same code, two clouds, both pwned where it counts.  
5. **`(misconfig)` is us.** Open CORS, 50 mb bodies, stack leak = demo app/env — not Express defaults, not CF/Vercel inventing them. Read the terminal kind tags.

**Last 30 seconds only (optional product / framework note):**

> “If you want a stack that *fails closed* on body limits, headers, rate limits, and schemas by default — that’s why secure-by-default frameworks exist. They still won’t invent your ownership rules. You write `order.userId === req.user.sub`.”

Do **not** open a 17-row feature matrix. Link README later.

**Ethics:**

> “Only systems you own. We’re tearing this down after the talk.” → [TEARDOWN.md](TEARDOWN.md)

---

## 40:00–45:00 — Q&A prompts you can answer

| Question | Answer |
| --- | --- |
| “Isn’t this just bad code?” | Yes for traversal/proxy/debug — labelled `app-code`. JWT/BOLA/BFLA chain is the thesis. |
| “What is BOLA / IDOR?” | Same class: object id trusted without ownership. IDOR = classic name; BOLA = OWASP API1. Alice’s JWT reading Bob’s orders. |
| “Express 5 fixed security?” | No — v5 is API cleanup, not a security model. |
| “Would helmet / rate-limit fix it?” | Partly transport; not BOLA/ownership. |
| “Cloudflare failed?” | No — edge did its job on some probes (`◇ PLATFORM`); app authz still missing. CORS/body/stack are `(misconfig)` from **our** app, not CF. |
| “Is open CORS a Vercel default?” | No. We added `cors({ origin: "*" })`. Same finding on CF. Tag: `misconfig`. |
| “Why 50 mb body?” | Demo honesty: Workers + attack need it; Express default is 100 kb; labelled `misconfig` in the report’s Whose fault? block. |

---

## Hostile / 2-minute backup

1. Health → express 5  
2. `node attack/attack.mjs URL` without `--drama`
3. Jump to LOOT users + JWT_SECRET + DEMO RESULT  
4. Optional: scroll to **REMEDIATION** footer (fix map by kind — not during LOOT)  
5. One line: Cloudflare ≠ authz; JWT ≠ security model  

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

---

## Further reading (same principle as this demo)

Not slides — optional handout / Q&A / “why this talk exists.”

| Source | Why it fits |
| --- | --- |
| [Secure defaults beat secure training](https://www.devsecstation.com/2602204/episodes/19503769-secure-defaults-beat-secure-training) (DevSecStation / Tanya Janca) | Core idea: most holes aren’t “developers don’t know” — the **easy path is insecure**. Training relies on memory and willpower; **defaults shape behavior**. Matches this demo’s thesis: incomplete setup feels normal; JWT alone is not a security model.  use after the attack, not during the run. |
