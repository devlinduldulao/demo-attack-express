/**
 * VaultPay API entrypoint — Express 5 + JWT demo.
 *
 * Default: INTENTIONALLY VULNERABLE.
 * Green run: HARDENED=1 node server.js
 *
 * Express 5 requires Node.js >= 18.
 *
 * Node / Azure:
 *   node server.js
 *   HARDENED=1 node server.js
 *
 * Cloudflare Workers uses worker.mjs (see DEPLOY-CLOUDFLARE.md).
 *
 * Attack:
 *   node ../attack/attack.mjs http://localhost:4000
 */

import { createApp } from "./app.js";

const PORT = Number(process.env.PORT) || 4000;
const { app, jwtSecret, hardened } = createApp();

// Express 5: listen callback receives an error argument on failure (e.g. EADDRINUSE).
const server = app.listen(PORT, (error) => {
  if (error) {
    console.error("Failed to bind server:", error);
    throw error;
  }
  console.log("");
  console.log("  ╔══════════════════════════════════════════════════════╗");
  if (hardened) {
    console.log("  ║  VaultPay API  —  Express 5 · HARDENED (green run)    ║");
  } else {
    console.log("  ║  VaultPay API  —  Express 5 · INTENTIONALLY WEAK      ║");
  }
  console.log("  ╚══════════════════════════════════════════════════════╝");
  console.log(`  Listening on http://localhost:${PORT}`);
  console.log(`  Express:     5.x (see package.json)`);
  console.log(`  Mode:        ${hardened ? "HARDENED=1" : "vulnerable (default)"}`);
  console.log(`  JWT secret:  ${jwtSecret}`);
  console.log("  Demo logins:");
  console.log("    alice@example.com / password123   (user)");
  console.log("    bob@example.com   / bobsecret     (user)");
  console.log("    admin@vaultpay.demo / admin123    (admin)");
  console.log("");
  console.log("  Attack this instance with:");
  console.log(`    node ../attack/attack.mjs http://localhost:${PORT}`);
  if (hardened) {
    console.log("  Expect: DEMO RESULT with 0 critical findings");
  }
  console.log("");
});

// Leave Node.js HTTP server timeouts at platform defaults (Node 18+:
// headersTimeout ~60s, requestTimeout ~300s). Older demos set these to 0 to
// manufacture a "no timeout" finding — that was a misconfig, not Express default.
// Express still has no middleware-level request budget; that gap is separate.

export { server, app };
