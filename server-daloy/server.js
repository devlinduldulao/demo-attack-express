/**
 * VaultPay API on DaloyJS — entrypoint.
 *
 *   node server.js                              scaffold defaults
 *   DALOY_OPT_IN=1 node server.js               + first-party opt-in helpers
 *   JWT_SECRET=supersecret123 node server.js    refuses to start (weak HS256 key)
 *
 * Attack:
 *   node ../attack/attackv2.mjs http://localhost:4100 --reset
 */

import { serve } from "@daloyjs/core/node";
import { createApp } from "./app.js";

const PORT = Number(process.env.PORT) || 4100;

let built;
try {
  built = createApp();
} catch (err) {
  console.error("");
  console.error("  ✗ DaloyJS refused to start");
  console.error(`    ${err.message}`);
  console.error("");
  process.exit(1);
}
const { app, jwtSecret, optIn, env } = built;

serve(app, { port: PORT });

const isTTY = process.stdout.isTTY;
const paint = (code, s) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
console.log("");
console.log(paint("1;38;5;40", "  ╔══════════════════════════════════════════════════════╗"));
console.log(paint("1;38;5;40", "  ║  VaultPay API  —  DaloyJS · same developer mistakes  ║"));
console.log(paint("1;38;5;40", "  ╚══════════════════════════════════════════════════════╝"));
console.log(`  Listening on ${paint("38;5;38", `http://localhost:${PORT}`)}  (env=${env})`);
console.log(`  Mode:        ${optIn ? "scaffold defaults + opt-in helpers (DALOY_OPT_IN=1)" : "scaffold defaults only"}`);
console.log(`  JWT secret:  ${paint("38;5;208", jwtSecret)}`);
console.log("  Demo logins: alice@example.com / password123 · bob@example.com / bobsecret · admin@vaultpay.demo / admin123");
console.log("");
console.log("  Attack this instance with:");
console.log(`    node ../attack/attackv2.mjs http://localhost:${PORT} --reset`);
console.log("");
