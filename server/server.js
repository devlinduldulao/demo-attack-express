/**
 * VaultPay API entrypoint — INTENTIONALLY VULNERABLE Express 5 + JWT demo.
 *
 * Express 5 requires Node.js >= 18.
 * Install: npm install express@5  (see package.json: express ^5.2.1)
 * Migrate guide: https://expressjs.com/en/guide/migrating-5/
 *
 * Node / Azure App Service:
 *   node server.js
 *   npm start
 *
 * Cloudflare Workers uses worker.mjs instead (see DEPLOY-CLOUDFLARE.md).
 *
 * Attack:
 *   node ../attack/attack.mjs http://localhost:4000
 */

import { createApp } from "./app.js";

const PORT = Number(process.env.PORT) || 4000;
const { app, jwtSecret } = createApp();

// Express 5: listen callback receives an error argument on failure (e.g. EADDRINUSE).
// https://expressjs.com/en/guide/migrating-5.html#applisten
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
  console.log("  Cloudflare Workers:");
  console.log("    npm run dev:cf     # local");
  console.log("    npm run deploy:cf  # https://vaultpay-api.<you>.workers.dev");
  console.log("");
});

// No idle / headers / request timeouts — Daloy sets requestTimeoutMs by default.
// Only apply if the underlying Node HTTP server exposes these (not on all adapters).
if (server && typeof server === "object") {
  try {
    server.headersTimeout = 0;
    server.requestTimeout = 0;
    server.timeout = 0;
  } catch {
    /* ignore on non-Node servers */
  }
}

export { server, app };
