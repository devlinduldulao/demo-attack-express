#!/usr/bin/env node
/**
 * SSRF stand-in: an "internal service" the API can reach and the client cannot.
 *
 * Why this exists
 * ---------------
 * The real attack we want to teach is: a handler fetches a user-supplied URL,
 * and the attacker pivots to something network-adjacent to the server — a cloud
 * metadata endpoint, an admin panel on a private subnet, an unauthenticated
 * internal API.
 *
 * We cannot demo that against Cloudflare Workers or Vercel: link-local egress
 * is refused, and Lambda does not serve credentials over IMDS anyway. Faking
 * IMDS *inside* VaultPay would be worse — it would make the app lie about what
 * it reached, and someone in the audience will know.
 *
 * So this is a genuinely separate process on its own loopback port. The pivot
 * is real (different service, different port, no auth); only the *contents* are
 * a stand-in for a cloud metadata document. Say that out loud on stage:
 *
 *   "This stands in for the cloud metadata service. On a real EC2 box this URL
 *    hands you the instance role's IAM credentials."
 *
 * Routes
 *   GET /health                       liveness (used to prove attacker reach)
 *   GET /latest/meta-data/...         IMDS-shaped fake credentials
 *   GET /redirect?to=<path>           302 → internal path (redirect-hop bypass)
 *
 * Everything here is fabricated. There are no real credentials in this file.
 *
 * Usage:
 *   node scripts/internal-service.mjs            # binds 127.0.0.1:9099
 *   INTERNAL_SERVICE_PORT=9999 node scripts/internal-service.mjs
 */

import { createServer } from "node:http";

const PORT = Number(process.env.INTERNAL_SERVICE_PORT) || 9099;
const HOST = "127.0.0.1";

/** Obviously-fake IMDS credential document. */
const FAKE_CREDENTIALS = {
  Code: "Success",
  LastUpdated: "2026-01-01T00:00:00Z",
  Type: "AWS-HMAC",
  AccessKeyId: "ASIA-DEMO-NOT-A-REAL-KEY",
  SecretAccessKey: "demo/fake/secret/do-not-use/000000000000",
  Token: "FAKE-SESSION-TOKEN-for-the-vaultpay-talk-only",
  Expiration: "2099-01-01T00:00:00Z",
};

const ROLE_PATH = "/latest/meta-data/iam/security-credentials/vaultpay-demo-role";

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  const send = (status, body, type = "application/json") => {
    res.writeHead(status, { "Content-Type": type });
    res.end(typeof body === "string" ? body : JSON.stringify(body, null, 2));
  };

  if (url.pathname === "/health") {
    return send(200, { ok: true, service: "internal-metadata-standin" });
  }

  // Open redirector: lets the attacker hand the proxy a URL that looks fine on
  // hop 1 and lands somewhere internal on hop 2. `fetch(..., {redirect:"follow"})`
  // will chase it, which is exactly the bypass a first-URL allowlist misses.
  if (url.pathname === "/redirect") {
    const to = url.searchParams.get("to") || ROLE_PATH;
    const target = to.startsWith("http") ? to : `http://${HOST}:${PORT}${to}`;
    res.writeHead(302, { Location: target });
    return res.end();
  }

  if (url.pathname === "/latest/meta-data/iam/security-credentials/") {
    return send(200, "vaultpay-demo-role\n", "text/plain");
  }

  if (url.pathname === ROLE_PATH) {
    return send(200, FAKE_CREDENTIALS);
  }

  if (url.pathname === "/latest/meta-data/" || url.pathname === "/latest/meta-data") {
    return send(200, ["ami-id", "hostname", "iam/", "instance-id", "local-ipv4"].join("\n"), "text/plain");
  }

  send(404, { error: "not found", path: url.pathname });
});

server.listen(PORT, HOST, () => {
  const isTTY = process.stdout.isTTY;
  const supports256 = isTTY && (typeof process.stdout.hasColors === "function" ? process.stdout.hasColors(256) : true);
  const cyan = isTTY ? (supports256 ? "\x1b[38;5;38m" : "\x1b[96m") : "";
  const yellow = isTTY ? (supports256 ? "\x1b[38;5;208m" : "\x1b[93m") : "";
  const reset = isTTY ? "\x1b[0m" : "";

  console.log(`  internal-service (SSRF stand-in) on ${cyan}http://${HOST}:${PORT}${reset}`);
  console.log(`  credentials path: ${yellow}${ROLE_PATH}${reset}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
