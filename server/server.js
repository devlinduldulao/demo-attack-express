/**
 * VaultPay API entrypoint — INTENTIONALLY VULNERABLE Express 5 + JWT demo.
 *
 * Express 5 requires Node.js >= 18.
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
  console.log("");
  console.log("  ╔══════════════════════════════════════════════════════╗");
  console.log("  ║  VaultPay API  —  Express 5 · INTENTIONALLY WEAK      ║");
  console.log("  ╚══════════════════════════════════════════════════════╝");
  console.log(`  Listening on http://localhost:${PORT}`);
  console.log(`  Express:     5.x (see package.json)`);
  console.log(`  JWT secret:  ${jwtSecret}`);
  console.log("  Demo logins:");
  console.log("    alice@example.com / password123   (user)");
  console.log("    bob@example.com   / bobsecret     (user)");
  console.log("    admin@vaultpay.demo / admin123    (admin)");
  console.log("");
  console.log("  Attack this instance with:");
  console.log(`    node ../attack/attack.mjs http://localhost:${PORT}`);
  console.log("");
});

// Leave Node.js HTTP server timeouts at platform defaults.


