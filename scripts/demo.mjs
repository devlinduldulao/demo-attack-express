#!/usr/bin/env node
/**
 * One-command local demo:
 *   1. boot vulnerable API on a free port
 *   2. wait for health
 *   3. run attack.mjs
 *   4. exit with attack exit code
 *
 * Usage (repo root):
 *   npm run demo
 *   npm run demo:hardened   # green run
 *   node scripts/demo.mjs --hardened --skip-flood
 */

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const serverDir = path.join(root, "server");
const attackScript = path.join(root, "attack", "attack.mjs");

const args = process.argv.slice(2);
const hardened = args.includes("--hardened") || process.env.HARDENED === "1";
const attackArgs = args.filter((a) => a !== "--hardened");

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

async function waitHealth(url, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
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

const port = await freePort();
const base = `http://127.0.0.1:${port}`;

const env = {
  ...process.env,
  PORT: String(port),
  HARDENED: hardened ? "1" : "",
  NODE_ENV: process.env.NODE_ENV || "development",
};

const child = spawn(process.execPath, ["server.js"], {
  cwd: serverDir,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

let serverLog = "";
child.stdout.on("data", (d) => {
  serverLog += d.toString();
});
child.stderr.on("data", (d) => {
  serverLog += d.toString();
});

const ready = await waitHealth(base);
if (!ready) {
  console.error("Server failed to become healthy.");
  console.error(serverLog);
  child.kill("SIGTERM");
  process.exit(1);
}

console.log(`\n  demo: server ready at ${base} (hardened=${hardened})\n`);

const attack = spawn(
  process.execPath,
  [attackScript, base, "--reset", ...attackArgs],
  {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  }
);

const code = await new Promise((resolve) => {
  attack.on("close", resolve);
});

child.kill("SIGTERM");
await new Promise((r) => child.on("close", r));

process.exit(code ?? 0);
