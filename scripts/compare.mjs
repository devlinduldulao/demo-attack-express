#!/usr/bin/env node
/**
 * Same attack, three builds of the same app — side by side.
 *
 *   1. boot the Express build            (server/)
 *   2. boot the DaloyJS build            (server-daloy/, scaffold defaults)
 *   3. boot the DaloyJS build + opt-ins  (server-daloy/, DALOY_OPT_IN=1)
 *   4. run attack/attackv2.mjs against each and read its JSON report
 *   5. try to boot each stack with JWT_SECRET=supersecret123
 *   6. print one row per probe, one column per build
 *
 * Every cell is what the attack script observed on the wire in that run.
 * Nothing in the table is hard-coded.
 *
 * Usage (repo root):
 *   npm run compare            # coloured terminal table
 *   npm run compare -- --md    # Markdown table (paste into slides / notes)
 *   npm run compare -- --json  # raw per-target reports
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const attackScript = path.join(root, "attack", "attackv2.mjs");
const args = new Set(process.argv.slice(2));
const asMarkdown = args.has("--md");
const asJson = args.has("--json");
const WEAK_SECRET = "supersecret123";

const TARGETS = [
  { key: "express", name: "Express 5", dir: "server", env: {} },
  { key: "daloy", name: "DaloyJS defaults", dir: "server-daloy", env: {} },
  { key: "daloyOptIn", name: "DaloyJS + opt-ins", dir: "server-daloy", env: { DALOY_OPT_IN: "1" } },
];

for (const dir of ["server", "server-daloy"]) {
  if (!existsSync(path.join(root, dir, "node_modules"))) {
    console.error(`Missing ${dir}/node_modules — run \`npm run install:all\` first.`);
    process.exit(2);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on("error", reject);
  });
}

async function waitHealth(url, child, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    if (child.exitCode !== null) return false;
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

function startServer(target, port, extraEnv = {}) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(root, target.dir),
    env: { ...process.env, ...target.env, ...extraEnv, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  return { child, output: () => output };
}

function stop(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    child.kill();
  });
}

function runAttack(base) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--no-warnings", attackScript, base, "--reset", "--quiet", "--json"],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      const start = out.lastIndexOf('\n{\n  "target"');
      if (code !== 0 || start === -1) {
        return reject(new Error(`attack against ${base} failed (exit ${code})\n${err || out.slice(-600)}`));
      }
      resolve(JSON.parse(out.slice(start)));
    });
  });
}

/** Does this stack start when handed the tutorial-grade signing secret? */
async function bootsWithWeakSecret(target) {
  const port = await freePort();
  const { child, output } = startServer(target, port, { JWT_SECRET: WEAK_SECRET });
  const up = await waitHealth(`http://127.0.0.1:${port}`, child, 30);
  await stop(child);
  const reason = /\[weak_hs_secret\][^\n]*/.exec(output())?.[0] || "";
  return { starts: up, reason };
}

// --- run -------------------------------------------------------------------
if (!asJson && !asMarkdown) console.log("\n  Booting three builds of VaultPay and attacking each…\n");

const reports = {};
const weak = {};
for (const target of TARGETS) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const { child, output } = startServer(target, port);
  try {
    if (!(await waitHealth(base, child))) {
      throw new Error(`${target.name} did not become healthy:\n${output().slice(-600)}`);
    }
    reports[target.key] = await runAttack(base);
  } finally {
    await stop(child);
  }
  weak[target.key] = await bootsWithWeakSecret(target);
}

if (asJson) {
  console.log(JSON.stringify({ reports, weakSecretBoot: weak }, null, 2));
  process.exit(0);
}

// --- render ----------------------------------------------------------------
const tty = process.stdout.isTTY && !asMarkdown;
const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = (s) => paint("1;38;5;203", s);
const amber = (s) => paint("1;38;5;208", s);
const green = (s) => paint("1;38;5;40", s);
const dim = (s) => paint("38;5;245", s);
const bold = (s) => paint("1", s);

/** @returns {[string, (s: string) => string]} cell text + colour */
function cell(probe) {
  if (!probe || probe.state === "not-reached") return ["– not reached", dim];
  if (probe.state === "blocked") return ["✓ blocked", green];
  if (probe.state === "reduced") return [`◐ reduced${probe.severity ? ` (${probe.severity.toLowerCase()})` : ""}`, amber];
  return [`✗ ${probe.severity || "OPEN"}`, red];
}

const probeIds = reports.express.probes.map((p) => [p.id, p.title]);
const rows = probeIds.map(([id, title]) => [
  title,
  ...TARGETS.map((t) => cell(reports[t.key].probes.find((p) => p.id === id))),
]);
rows.push([
  `Starts with JWT_SECRET=${WEAK_SECRET}`,
  ...TARGETS.map((t) => (weak[t.key].starts ? ["✗ starts", red] : ["✓ refuses to start", green])),
]);

const count = (key, state) => reports[key].probes.filter((p) => p.state === state).length;
const totals = TARGETS.map((t) => {
  const r = reports[t.key];
  const crit = r.findings.filter((f) => f.severity === "CRITICAL").length;
  return `${crit} critical · ${count(t.key, "blocked")} blocked · ${count(t.key, "reduced")} reduced`;
});

if (asMarkdown) {
  const strip = ([text]) => text;
  console.log(`| Attack | ${TARGETS.map((t) => t.name).join(" | ")} |`);
  console.log(`| --- | ${TARGETS.map(() => "---").join(" | ")} |`);
  for (const [title, ...cells] of rows) console.log(`| ${title} | ${cells.map(strip).join(" | ")} |`);
  console.log(`| **Totals** | ${totals.join(" | ")} |`);
  process.exit(0);
}

const W0 = Math.max(...rows.map((r) => r[0].length)) + 2;
const W = 20;
const line = "─".repeat(W0 + W * TARGETS.length);

console.log(`  ${bold("Attack".padEnd(W0))}${TARGETS.map((t) => bold(t.name.padEnd(W))).join("")}`);
console.log(`  ${dim(line)}`);
for (const [title, ...cells] of rows) {
  console.log(`  ${title.padEnd(W0)}${cells.map(([text, colour]) => colour(text.padEnd(W))).join("")}`);
}
console.log(`  ${dim(line)}`);
console.log(`  ${"Criticals".padEnd(W0)}${TARGETS.map((t) => String(reports[t.key].findings.filter((f) => f.severity === "CRITICAL").length).padEnd(W)).join("")}`);
console.log("");
console.log(`  ${red("✗")} the attack worked   ${amber("◐")} hole still open, less to steal   ${green("✓")} the server refused the probe`);
console.log("");
console.log(dim("  Same routes, same data, same handler mistakes in all three builds (see server-daloy/app.js)."));
console.log(dim("  DaloyJS defaults  = what `pnpm create daloy` scaffolds, nothing added."));
console.log(dim("  DaloyJS + opt-ins = requireRoles · fetchGuard · assertSafeRelativePath · safeRedirect · loginThrottle."));
console.log(dim("  Neither DaloyJS build adds an ownership check or removes the debug endpoint: no framework can."));
if (weak.daloy.reason) console.log(dim(`  Weak secret: ${weak.daloy.reason}`));
console.log("");
