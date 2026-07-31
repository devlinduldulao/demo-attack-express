/**
 * Green-run tests: HARDENED mode must close the documented fail-open vulns.
 * Mirror of the "documented vulnerabilities" suite in server.test.js.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import db from "../server/db.js";

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
  return res.json;
}

before(async () => {
  const { app } = createApp({ hardened: true });
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

describe("hardened mode — green run controls", () => {
  it("health reports hardened=true", async () => {
    const res = await req("GET", "/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.json.hardened, true);
  });

  it("sets secure browser headers and hides X-Powered-By", async () => {
    const res = await req("GET", "/api/health");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["x-frame-options"], "DENY");
    assert.ok(res.headers["content-security-policy"]);
    assert.equal(res.headers["x-powered-by"], undefined);
  });

  it("rejects oversized JSON with 413 (100kb)", async () => {
    const pad = "y".repeat(120 * 1024);
    const res = await req("POST", "/api/auth/login", {
      body: { email: "alice@example.com", password: pad },
    });
    assert.equal(res.status, 413);
  });

  it("GET /api/users without auth → 401", async () => {
    const res = await req("GET", "/api/users");
    assert.equal(res.status, 401);
  });

  it("GET /api/users/:id without auth → 401", async () => {
    const res = await req("GET", "/api/users/1");
    assert.equal(res.status, 401);
  });

  it("IDOR blocked: Alice cannot read Bob full profile as admin dump", async () => {
    const { token } = await login();
    const res = await req("GET", "/api/users/2", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 403);
  });

  it("Alice can read self (public fields only)", async () => {
    const { token } = await login();
    const res = await req("GET", "/api/users/1", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.email, "alice@example.com");
    assert.equal(res.json.user.ssn, undefined);
    assert.equal(res.json.user.cardNumber, undefined);
  });

  it("debug config is gone", async () => {
    const res = await req("GET", "/api/debug/config");
    assert.equal(res.status, 404);
    assert.equal(res.json?.jwtSecret, undefined);
  });

  it("path traversal does not leak secrets", async () => {
    const res = await req("GET", "/api/files?name=../secrets/jwt-backup.txt");
    assert.ok(res.status === 400 || res.status === 404);
    assert.ok(!/JWT_SECRET=/.test(res.text));
  });

  it("open redirect rejects absolute URLs", async () => {
    const res = await req("GET", "/api/go?url=" + encodeURIComponent("https://evil.example/"));
    assert.equal(res.status, 400);
  });

  it("open proxy is disabled", async () => {
    const res = await req("GET", "/api/proxy?url=" + encodeURIComponent("https://example.com/"));
    assert.equal(res.status, 404);
  });

  it("BOLA closed: orders scoped to self", async () => {
    const { token, user } = await login();
    const res = await req("GET", "/api/orders", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.orders));
    for (const o of res.json.orders) {
      assert.equal(o.userId, user.id);
    }
  });

  it("mass assignment cannot set role=admin", async () => {
    const { token } = await login();
    const res = await req("PUT", "/api/users/1", {
      headers: { Authorization: `Bearer ${token}` },
      body: { role: "admin", balance: 999999, name: "Alice H" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.role, "user");
    assert.notEqual(res.json.user.balance, 999999);
    assert.equal(res.json.user.name, "Alice H");
  });

  it("cross-user write is forbidden", async () => {
    const { token } = await login();
    const res = await req("PUT", "/api/users/2", {
      headers: { Authorization: `Bearer ${token}` },
      body: { name: "Hijacked Bob" },
    });
    assert.equal(res.status, 403);
  });

  it("admin stats require role admin", async () => {
    const { token } = await login();
    const res = await req("GET", "/api/admin/stats", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 403);
  });

  it("admin can hit admin stats", async () => {
    const { token } = await login("admin@vaultpay.demo", "admin123");
    const res = await req("GET", "/api/admin/stats", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.ok(res.json.users >= 3);
  });

  it("login errors are uniform (no enumeration)", async () => {
    const missing = await req("POST", "/api/auth/login", {
      body: { email: "nope@example.com", password: "x" },
    });
    const wrong = await req("POST", "/api/auth/login", {
      body: { email: "alice@example.com", password: "wrong" },
    });
    assert.equal(missing.status, 401);
    assert.equal(wrong.status, 401);
    assert.equal(missing.json.error, wrong.json.error);
  });

  it("boom does not leak stack", async () => {
    const res = await req("GET", "/api/boom");
    assert.equal(res.status, 500);
    assert.equal(res.json.stack, undefined);
  });

  it("echo is not text/html XSS sink", async () => {
    const payload = `<img src=x onerror=alert(1)>`;
    const res = await req("GET", `/api/echo?msg=${encodeURIComponent(payload)}`);
    assert.equal(res.status, 200);
    assert.ok(!/text\/html/i.test(res.headers["content-type"] || ""));
  });

  it("settings write requires auth", async () => {
    const res = await req("PUT", "/api/settings", {
      body: { injected: true, theme: "blood" },
    });
    assert.equal(res.status, 401);
  });

  it("demo reset is not available", async () => {
    const res = await req("POST", "/api/demo/reset");
    assert.equal(res.status, 404);
  });
});
