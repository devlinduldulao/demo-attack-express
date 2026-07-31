/**
 * VaultPay API entrypoint — INTENTIONALLY VULNERABLE Express + JWT demo.
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

const server = app.listen(PORT, () => {
  console.log("");
  console.log("  ╔══════════════════════════════════════════════════════╗");
  console.log("  ║  VaultPay API  —  INTENTIONALLY VULNERABLE DEMO      ║");
  console.log("  ╚══════════════════════════════════════════════════════╝");
  console.log(`  Listening on http://localhost:${PORT}`);
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
server.headersTimeout = 0;
server.requestTimeout = 0;
server.timeout = 0;

export { server, app };
