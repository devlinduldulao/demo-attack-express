/**
 * VaultPay API entrypoint — INTENTIONALLY VULNERABLE Express 5 + JWT demo.
 *
 * Express 5 requires Node.js >= 18; this package pins engines.node >= 24.
 *
 * Node / Azure:
 *   node server.js
 *
 * Cloudflare Workers uses worker.mjs (see DEPLOY-CLOUDFLARE.md).
 *
 * Attack:
 *   node ../attack/attack.mjs http://localhost:4000
 */

import { createApp } from "./app.js";

const PORT = Number(process.env.PORT) || 4000;
const { app, jwtSecret } = createApp();

const server = app.listen(PORT, (error) => {
  if (error) {
    console.error("Failed to bind server:", error);
    throw error;
  }
  const isTTY = process.stdout.isTTY;
  const supports256 = isTTY && (typeof process.stdout.hasColors === "function" ? process.stdout.hasColors(256) : true);
  const cyan = isTTY ? (supports256 ? "\x1b[38;5;38m" : "\x1b[96m") : "";
  const yellow = isTTY ? (supports256 ? "\x1b[38;5;208m" : "\x1b[93m") : "";
  const magenta = isTTY ? (supports256 ? "\x1b[38;5;171m" : "\x1b[95m") : "";
  const bold = isTTY ? "\x1b[1m" : "";
  const reset = isTTY ? "\x1b[0m" : "";

  console.log("");
  console.log(`  ${magenta}${bold}╔══════════════════════════════════════════════════════╗${reset}`);
  console.log(`  ${magenta}${bold}║  VaultPay API  —  Express 5 · INTENTIONALLY WEAK      ║${reset}`);
  console.log(`  ${magenta}${bold}╚══════════════════════════════════════════════════════╝${reset}`);
  console.log(`  Listening on ${cyan}http://localhost:${PORT}${reset}`);
  console.log(`  Express:     5.x (see package.json)`);
  console.log(`  JWT secret:  ${yellow}${jwtSecret}${reset}`);
  console.log("  Demo logins:");
  console.log(`    ${cyan}alice@example.com${reset} / password123   (user)`);
  console.log(`    ${cyan}bob@example.com${reset}   / bobsecret     (user)`);
  console.log(`    ${cyan}admin@vaultpay.demo${reset} / admin123    (admin)`);
  console.log("");
  console.log("  Attack this instance with:");
  console.log(`    ${bold}node ../attack/attack.mjs http://localhost:${PORT}${reset}`);
  console.log("");
});

// Leave Node.js HTTP server timeouts at platform defaults.


