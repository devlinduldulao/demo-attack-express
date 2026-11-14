/**
 * Intentional path-traversal playground that works on Node AND Cloudflare Workers.
 *
 * Real `fs.readFileSync` is unreliable/absent on Workers. This virtual FS keeps
 * the same vulnerability: user input is joined under data/public without a
 * containment check, so `../secrets/...` still escapes into the secrets tree.
 *
 * Uses path.posix so Windows local demos and Linux Workers behave the same.
 */

import path from "node:path";

const posix = path.posix;

/**
 * Build the virtual file tree. The "backup" holds whatever signing secret the
 * app was started with — the Express demo passes nothing and gets the weak
 * default; the DaloyJS port (server-daloy/) passes the key it actually signs with.
 * @param {string} [jwtSecret]
 */
export function buildFiles(jwtSecret = "supersecret123") {
  return {
  "data/public/welcome.txt":
    "Welcome to VaultPay public files.\n\n" +
    "This file is meant to be readable.\n" +
    "The secrets/ folder next door is NOT meant to be readable — but path traversal will reach it.\n",

  "data/secrets/jwt-backup.txt":
    "# INTERNAL — DO NOT SERVE\n" +
    `JWT_SECRET=${jwtSecret}\n` +
    "ADMIN_RECOVERY_CODE=vault-recover-9911\n" +
    "DB_CONNECTION=memory://vaultpay\n",
  };
}

const FILES = buildFiles();

/**
 * Resolve a user-supplied relative name the vulnerable way.
 * @param {string} name
 * @param {Record<string, string>} [files] file tree from {@link buildFiles}
 * @returns {{ path: string, content: string }}
 */
export function readUserFile(name, files = FILES) {
  const base = "data/public";
  // VULNERABLE: no root containment — normalize still allows `..` escape.
  const target = posix.normalize(posix.join(base, String(name)));
  const content = files[target];
  if (content === undefined) {
    const err = new Error(`ENOENT: no such file or directory, open '${target}'`);
    err.code = "ENOENT";
    err.path = target;
    throw err;
  }
  return { path: target, content };
}
