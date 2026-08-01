#!/usr/bin/env node
/**
 * One-command local demo:
 *   1. boot the SSRF stand-in "internal service" on a free port
 *   2. boot the API on another free port
 *   3. wait for health
 *   4. run attack.mjs against it
 *   5. tear both down, exit with the attack's exit code
 *
 * The internal service is what makes the SSRF pivot real locally: the API can
 * reach it, the attacker cannot reach it directly through the API's origin.
 * See scripts/internal-service.mjs.
 *
 * Usage (repo root):
 *   npm run demo
 *   node scripts/demo.mjs --skip-flood
 */

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const serverDir = path.join(root, "server");
const attackScript = path.join(root, "attack", "attack.mjs");
const attackArgs = process.argv.slice(2);

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
const internalPort = await freePort();
const base = `http://127.0.0.1:${port}`;
const internalBase = `http://127.0.0.1:${internalPort}`;

// SSRF stand-in: a service the API can reach on the server's own loopback.
const internal = spawn(
  process.execPath,
  [path.join(root, "scripts", "internal-service.mjs")],
  {
    cwd: root,
    env: { ...process.env, INTERNAL_SERVICE_PORT: String(internalPort) },
    stdio: ["ignore", "pipe", "pipe"],
  }
);
let internalLog = "";
internal.stdout.on("data", (d) => {
  internalLog += d.toString();
});
internal.stderr.on("data", (d) => {
  internalLog += d.toString();
});

const env = {
  ...process.env,
  PORT: String(port),
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
  internal.kill("SIGTERM");
  process.exit(1);
}

console.log(`\n  demo: vulnerable API ready at ${base}`);
console.log(`  demo: internal service (SSRF target) at ${internalBase}\n`);

const attack = spawn(
  process.execPath,
  [attackScript, base, "--reset", `--internal=${internalBase}`, ...attackArgs],
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
internal.kill("SIGTERM");
await new Promise((r) => child.on("close", r));

process.exit(code ?? 0);
