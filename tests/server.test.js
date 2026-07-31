/**
 * Happy-path + unhappy-path tests for the intentionally vulnerable VaultPay API.
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

function listen(app) {
  return new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      resolve({ server: s, base: `http://127.0.0.1:${port}` });
    });
  });
}

async function req(method, path, { headers = {}, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  const headerObj = {};
  res.headers.forEach((v, k) => {
    headerObj[k.toLowerCase()] = v;
  });
  return { status: res.status, headers: headerObj, text, json };
}

async function login(email = "alice@example.com", password = "password123") {
  const res = await req("POST", "/api/auth/login", { body: { email, password } });
  assert.equal(res.status, 200, `login failed: ${res.text}`);
  assert.ok(res.json.token);
  return res.json;
}

before(async () => {
  const { app } = createApp();
  const started = await listen(app);
  server = started.server;
  base = started.base;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  db.reset();
});

describe("happy paths", () => {
  it("GET /api/health returns ok (Express 5 demo)", async () => {
    const res = await req("GET", "/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.service, "vaultpay-api");
    assert.equal(res.json.express, "5");
  });

  it("POST /api/auth/login returns JWT + public user", async () => {
    const res = await req("POST", "/api/auth/login", {
      body: { email: "alice@example.com", password: "password123" },
    });
    assert.equal(res.status, 200);
    assert.equal(typeof res.json.token, "string");
    assert.equal(res.json.user.email, "alice@example.com");
    assert.equal(res.json.user.role, "user");
    assert.equal(res.json.user.password, undefined);
    assert.equal(res.json.user.ssn, undefined);
  });

  it("GET /api/me with valid Bearer returns the caller", async () => {
    const { token, user } = await login();
    const res = await req("GET", "/api/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.id, user.id);
    assert.equal(res.json.user.email, "alice@example.com");
  });

  it("POST /api/auth/register creates a user and returns a token", async () => {
    const res = await req("POST", "/api/auth/register", {
      body: { email: "new@example.com", password: "newpass1", name: "New User" },
    });
    assert.equal(res.status, 201);
    assert.ok(res.json.token);
    assert.equal(res.json.user.email, "new@example.com");
    assert.equal(res.json.user.role, "user");
  });

  it("POST /api/orders creates an order for the authenticated user", async () => {
    const { token, user } = await login();
    const res = await req("POST", "/api/orders", {
      headers: { Authorization: `Bearer ${token}` },
      body: { merchant: "Test Shop", amount: 12.5 },
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.order.merchant, "Test Shop");
    assert.equal(res.json.order.userId, user.id);
    assert.equal(res.json.order.amount, 12.5);
  });

  it("GET /api/files?name=welcome.txt serves the public file", async () => {
    const res = await req("GET", "/api/files?name=welcome.txt");
    assert.equal(res.status, 200);
    assert.match(res.text, /Welcome to VaultPay/);
  });
});

describe("unhappy paths — controls that exist", () => {
  it("GET /api/me without token → 401", async () => {
    const res = await req("GET", "/api/me");
    assert.equal(res.status, 401);
    assert.match(res.json.error, /token/i);
  });

  it("GET /api/me with garbage token → 401", async () => {
    const res = await req("GET", "/api/me", {
      headers: { Authorization: "Bearer not.a.jwt" },
    });
    assert.equal(res.status, 401);
  });

  it("POST /api/auth/login with wrong password → 401", async () => {
    const res = await req("POST", "/api/auth/login", {
      body: { email: "alice@example.com", password: "nope" },
    });
    assert.equal(res.status, 401);
  });

  it("POST /api/auth/login missing fields → 400", async () => {
    const res = await req("POST", "/api/auth/login", { body: { email: "a@b.c" } });
    assert.equal(res.status, 400);
  });

  it("POST /api/auth/register duplicate email → 409", async () => {
    const res = await req("POST", "/api/auth/register", {
      body: { email: "alice@example.com", password: "x", name: "A" },
    });
    assert.equal(res.status, 409);
  });

  it("GET /api/orders without token → 401", async () => {
    const res = await req("GET", "/api/orders");
    assert.equal(res.status, 401);
  });

  it("GET /api/users/999 → 404", async () => {
    const res = await req("GET", "/api/users/999");
    assert.equal(res.status, 404);
  });

  it("GET /api/files missing name → 400", async () => {
    const res = await req("GET", "/api/files");
    assert.equal(res.status, 400);
  });

  it("GET unknown route → 404", async () => {
    const res = await req("GET", "/api/nope");
    assert.equal(res.status, 404);
  });
});

describe("documented vulnerabilities (expected fail-open)", () => {
  it("GET /api/users dumps accounts without auth", async () => {
    const res = await req("GET", "/api/users");
    assert.equal(res.status, 200);
    assert.ok(res.json.users.length >= 4);
    assert.ok(res.json.users[0].ssn);
    assert.ok(res.json.users[0].cardNumber);
  });

  it("GET /api/users/:id IDOR returns PII without auth", async () => {
    const res = await req("GET", "/api/users/1");
    assert.equal(res.status, 200);
    assert.equal(res.json.user.email, "alice@example.com");
    assert.ok(res.json.user.cardCvv);
  });

  it("GET /api/debug/config leaks JWT secret without auth", async () => {
    const res = await req("GET", "/api/debug/config");
    assert.equal(res.status, 200);
    assert.equal(typeof res.json.jwtSecret, "string");
    assert.ok(res.json.jwtSecret.length > 0);
  });

  it("GET /api/files path traversal reads secrets", async () => {
    const res = await req("GET", "/api/files?name=../secrets/jwt-backup.txt");
    assert.equal(res.status, 200);
    assert.match(res.text, /JWT_SECRET=/);
  });

  it("GET /api/go open-redirects to external URL", async () => {
    const res = await req("GET", "/api/go?url=https://evil.example/phish");
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /evil\.example/);
  });

  it("login error messages enumerate accounts", async () => {
    const missing = await req("POST", "/api/auth/login", {
      body: { email: "nope@example.com", password: "x" },
    });
    const wrong = await req("POST", "/api/auth/login", {
      body: { email: "alice@example.com", password: "wrong" },
    });
    assert.equal(missing.status, 401);
    assert.equal(wrong.status, 401);
    assert.notEqual(missing.json.error, wrong.json.error);
  });

  it("authenticated user reads all orders (BOLA)", async () => {
    const { token, user } = await login();
    const res = await req("GET", "/api/orders", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const foreign = res.json.orders.filter((o) => o.userId !== user.id);
    assert.ok(foreign.length >= 1, "expected other users' orders");
  });

  it("mass assignment promotes user to admin", async () => {
    const { token, user } = await login();
    const res = await req("PUT", `/api/users/${user.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      body: { role: "admin", balance: 999 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.role, "admin");
    assert.equal(res.json.user.balance, 999);
  });

  it("cross-user write is allowed with any JWT", async () => {
    const { token } = await login("alice@example.com", "password123");
    const res = await req("PUT", "/api/users/2", {
      headers: { Authorization: `Bearer ${token}` },
      body: { internalNote: "alice rewrote bob" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.internalNote, "alice rewrote bob");
  });

  it("non-admin JWT can hit /api/admin/stats", async () => {
    const { token } = await login();
    const res = await req("GET", "/api/admin/stats", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.accounts));
    assert.ok(res.json.accounts[0].password);
  });

  it("forged JWT with leaked secret is accepted", async () => {
    const dbg = await req("GET", "/api/debug/config");
    const secret = dbg.json.jwtSecret;
    const now = Math.floor(Date.now() / 1000);
    const forged = signHs256(
      {
        sub: 3,
        email: "admin@vaultpay.demo",
        role: "admin",
        name: "Forged",
        iat: now,
        exp: now + 3600,
      },
      secret
    );
    const res = await req("GET", "/api/me", {
      headers: { Authorization: `Bearer ${forged}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.email, "admin@vaultpay.demo");
  });

  it("GET /api/boom leaks stack traces", async () => {
    const res = await req("GET", "/api/boom");
    assert.equal(res.status, 500);
    assert.ok(res.json.stack);
  });

  it("GET /api/echo reflects HTML (XSS sink)", async () => {
    const payload = `<img src=x onerror=alert(1)>`;
    const res = await req("GET", `/api/echo?msg=${encodeURIComponent(payload)}`);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"] || "", /html/i);
    assert.ok(res.text.includes(payload));
  });

  it("PUT /api/settings accepts unauthenticated mass assignment", async () => {
    const res = await req("PUT", "/api/settings", {
      body: { injected: true, theme: "blood" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.settings.injected, true);
    assert.equal(res.json.settings.theme, "blood");
  });

  it("response lacks secure browser headers", async () => {
    const res = await req("GET", "/api/health");
    assert.equal(res.headers["x-frame-options"], undefined);
    assert.equal(res.headers["content-security-policy"], undefined);
    assert.equal(res.headers["x-content-type-options"], undefined);
  });

  it("accepts a >1 MiB JSON body (no tight bodyLimit)", async () => {
    const pad = "y".repeat(1.2 * 1024 * 1024);
    const res = await req("POST", "/api/auth/login", {
      body: { email: "alice@example.com", password: pad },
    });
    assert.notEqual(res.status, 413);
    assert.ok(res.status === 401 || res.status === 200 || res.status === 400);
  });

  it("CORS allows any origin", async () => {
    const res = await fetch(`${base}/api/health`, {
      headers: { Origin: "https://evil.example" },
    });
    const acao = res.headers.get("access-control-allow-origin");
    assert.ok(acao === "*" || acao === "https://evil.example");
  });
});
