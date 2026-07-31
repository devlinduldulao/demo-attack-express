/**
 * VaultPay Express app factory — INTENTIONALLY VULNERABLE.
 *
 * Maps 1:1 to protections DaloyJS enables by default (see README table).
 * Export `createApp()` so tests can boot an isolated instance per case.
 */

import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import db from "./db.js";
import { unsafeDeepMerge } from "./merge.js";
import { readUserFile } from "./vfs.js";

const JWT_SECRET = process.env.JWT_SECRET || "supersecret123";

/** Default body cap is huge on purpose (Daloy defaults to 1 MiB). */
const BODY_LIMIT = process.env.BODY_LIMIT || "50mb";

/**
 * Parse sizes like "50mb", "1.5mb", "1024kb", "100" (bytes).
 * @param {string|number} value
 * @returns {number}
 */
function parseSize(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = String(value || "").trim().toLowerCase();
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/.exec(s);
  if (!m) return 50 * 1024 * 1024;
  const n = Number(m[1]);
  const unit = m[2] || "b";
  const mult = { b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 }[unit];
  return Math.floor(n * mult);
}

/**
 * Minimal JSON body parser (no body-parser / iconv-lite).
 *
 * Express's built-in express.json() pulls iconv-lite, which currently breaks
 * under Wrangler's Workers bundle (`require_streams is not a function`).
 * This keeps the same oversized-body demo behavior on Node, Azure, and CF.
 *
 * @param {{ limit?: string|number }} [opts]
 * @returns {import("express").RequestHandler}
 */
function jsonBody(opts = {}) {
  const limit = parseSize(opts.limit ?? BODY_LIMIT);
  return (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      return next();
    }
    const ct = String(req.headers["content-type"] || "");
    if (!ct.includes("application/json")) {
      req.body = req.body || {};
      return next();
    }

    const chunks = [];
    let total = 0;
    let done = false;

    const fail = (status, error) => {
      if (done) return;
      done = true;
      res.status(status).json({ error });
    };

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        fail(413, `request entity too large (limit ${limit} bytes)`);
        try {
          req.destroy();
        } catch {
          /* ignore */
        }
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (done) return;
      done = true;
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        req.body = raw ? JSON.parse(raw) : {};
        next();
      } catch {
        res.status(400).json({ error: "invalid json body" });
      }
    });

    req.on("error", (err) => {
      if (done) return;
      done = true;
      next(err);
    });
  };
}

/** Detect Cloudflare Workers / Wrangler for the debug banner (best-effort). */
function runtimeLabel() {
  if (process.env.CF_WORKER || process.env.WRANGLER || process.env.CLOUDFLARE_WORKER) {
    return "cloudflare-workers";
  }
  // Wrangler injects this in recent versions when running under the Workers runtime.
  if (typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers") {
    return "cloudflare-workers";
  }
  return process.env.RUNTIME || "node";
}

/**
 * Create the vulnerable Express application.
 * @param {{ jwtSecret?: string }} [opts]
 * @returns {{ app: import("express").Express, jwtSecret: string, db: typeof db }}
 */
function createApp(opts = {}) {
  const secret = opts.jwtSecret || JWT_SECRET;
  const app = express();

  // Wide-open CORS — Stack Overflow default. Daloy: corsCrossOriginGuard.
  app.use(
    cors({
      origin: "*",
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    })
  );

  // Oversized body allowed (~50mb). Daloy: bodyLimitBytes = 1 MiB.
  // Custom parser: express.json() → body-parser → iconv-lite breaks on Workers.
  // No requestTimeoutMs equivalent is registered at all.
  app.use(jsonBody({ limit: BODY_LIMIT }));

  // No secureHeaders middleware (no X-Frame-Options, CSP, HSTS, nosniff, …).

  function requireAuth(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: "Missing token. Please login." });
    }
    try {
      req.user = jwt.verify(token, secret);
      next();
    } catch (err) {
      return res.status(401).json({
        error: "Invalid or expired token.",
        // Verbose auth errors — leaks verification internals.
        detail: err && err.message,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Health / marketing
  // -------------------------------------------------------------------------
  app.get("/", (_req, res) => {
    res.json({
      name: "VaultPay API",
      version: "1.0.0",
      message: "Secure online banking powered by JWT ✨",
      docs: {
        login: "POST /api/auth/login",
        me: "GET /api/me  (Bearer token required)",
        users: "GET /api/users",
        orders: "GET /api/orders",
        files: "GET /api/files?name=welcome.txt",
        proxy: "GET /api/proxy?url=",
        go: "GET /api/go?url=",
      },
    });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "vaultpay-api", time: new Date().toISOString() });
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------
  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password required" });
    }

    // Account enumeration: different messages for missing user vs bad password.
    // Daloy + good practice: same generic message + timingSafeEqual.
    const user = db.users.find((u) => u.email === email);
    if (!user) {
      return res.status(401).json({ error: "No account for that email" });
    }
    // Plain-text compare (not timing-safe).
    if (user.password !== password) {
      return res.status(401).json({ error: "Incorrect password" });
    }

    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role, name: user.name },
      secret,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: db.publicUser(user),
      message: "Welcome back! Your session is secured with JWT.",
    });
  });

  app.post("/api/auth/register", (req, res) => {
    const { email, password, name } = req.body || {};
    if (!email || !password || !name) {
      return res.status(400).json({ error: "email, password, and name required" });
    }
    if (db.users.some((u) => u.email === email)) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const user = {
      id: db.bumpUserId(),
      email,
      password,
      name,
      role: "user",
      ssn: "000-00-0000",
      phone: "",
      address: "",
      balance: 0,
      cardNumber: "0000 0000 0000 0000",
      cardCvv: "000",
      internalNote: "Self-registered",
    };
    db.users.push(user);

    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role, name: user.name },
      secret,
      { expiresIn: "7d" }
    );
    res.status(201).json({ token, user: db.publicUser(user) });
  });

  app.get("/api/me", requireAuth, (req, res) => {
    const user = db.users.find((u) => u.id === req.user.sub);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user: db.publicUser(user) });
  });

  // -------------------------------------------------------------------------
  // Broken access control / excessive data exposure
  // -------------------------------------------------------------------------
  app.get("/api/users", (_req, res) => {
    res.json({
      users: db.users.map((u) => db.fullUser(u)),
      total: db.users.length,
    });
  });

  app.get("/api/users/:id", (req, res) => {
    const user = db.users.find((u) => u.id === Number(req.params.id));
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user: db.fullUser(user) });
  });

  app.put("/api/users/:id", requireAuth, (req, res) => {
    const user = db.users.find((u) => u.id === Number(req.params.id));
    if (!user) return res.status(404).json({ error: "User not found" });

    // Mass assignment + unsafe deep merge (no field allowlist, no ownership).
    const body = req.body || {};
    unsafeDeepMerge(user, body);
    // Keep id stable even if client tried to overwrite it.
    user.id = Number(req.params.id);

    res.json({
      message: "Profile updated",
      user: db.fullUser(user),
    });
  });

  app.get("/api/orders", requireAuth, (_req, res) => {
    res.json({ orders: db.orders, total: db.orders.length });
  });

  app.get("/api/orders/:id", requireAuth, (req, res) => {
    const order = db.orders.find((o) => o.id === Number(req.params.id));
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json({ order });
  });

  app.post("/api/orders", requireAuth, (req, res) => {
    const { merchant, amount } = req.body || {};
    if (!merchant || amount == null) {
      return res.status(400).json({ error: "merchant and amount required" });
    }
    const user = db.users.find((u) => u.id === req.user.sub);
    const order = {
      id: db.bumpOrderId(),
      userId: req.user.sub,
      merchant,
      amount: Number(amount),
      status: "pending",
      cardLast4: user ? String(user.cardNumber).slice(-4) : "0000",
      createdAt: new Date().toISOString(),
    };
    db.orders.push(order);
    res.status(201).json({ order });
  });

  app.get("/api/admin/stats", requireAuth, (_req, res) => {
    const totalBalance = db.users.reduce((sum, u) => sum + Number(u.balance || 0), 0);
    res.json({
      users: db.users.length,
      orders: db.orders.length,
      totalBalance,
      accounts: db.users.map((u) => db.dumpUser(u)),
    });
  });

  app.get("/api/debug/config", (_req, res) => {
    res.json({
      env: process.env.NODE_ENV || "development",
      runtime: runtimeLabel(),
      jwtSecret: secret,
      jwtAlgorithm: "HS256",
      bodyLimit: BODY_LIMIT,
      database: "in-memory",
      featureFlags: {
        rateLimit: false,
        roleChecks: false,
        fieldAllowlist: false,
        ownershipChecks: false,
        bodyLimitStrict: false,
        requestTimeout: false,
        secureHeaders: false,
        pathTraversalGuard: false,
        ssrfGuard: false,
        openRedirectGuard: false,
      },
      hint: "This endpoint should never exist in production.",
    });
  });

  app.get("/api/search", (req, res) => {
    const q = String(req.query.q || "").toLowerCase();
    if (!q) return res.json({ results: [] });
    const results = db.users
      .filter((u) => {
        const haystack = [u.name, u.email, u.ssn, u.phone, u.address, u.internalNote]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .map((u) => db.fullUser(u));
    res.json({ results, query: q });
  });

  // -------------------------------------------------------------------------
  // Transport / framework-default holes (no login required)
  // -------------------------------------------------------------------------

  /**
   * Path traversal — junior "static file" endpoint.
   * Daloy routing hardens path normalization; this joins user input raw.
   *
   * Uses an in-memory VFS so the same bug works on Node, Azure, and
   * Cloudflare Workers (no real disk on Workers).
   */
  app.get("/api/files", (req, res) => {
    const name = String(req.query.name || "");
    if (!name) {
      return res.status(400).json({ error: "name query required", example: "welcome.txt" });
    }
    try {
      const file = readUserFile(name);
      res.type("text/plain").send(file.content);
    } catch (err) {
      res.status(404).json({
        error: "File not found",
        // Path + error leak (still vulnerable on purpose).
        path: err.path || name,
        detail: err.message,
      });
    }
  });

  /**
   * Open redirect — "login return URL" without allowlist.
   * Daloy: safeRedirect.
   */
  app.get("/api/go", (req, res) => {
    const url = String(req.query.url || "/");
    // VULNERABLE: any absolute URL accepted.
    res.redirect(302, url);
  });

  /**
   * SSRF-ish open proxy — fetches any URL server-side.
   * Daloy: fetchGuard blocks link-local / metadata / private ranges by default.
   */
  app.get("/api/proxy", async (req, res) => {
    const url = String(req.query.url || "");
    if (!url) return res.status(400).json({ error: "url query required" });
    try {
      const upstream = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
      });
      const text = await upstream.text();
      res.status(upstream.status).type("text/plain").send(text.slice(0, 50_000));
    } catch (err) {
      res.status(502).json({
        error: "Upstream fetch failed",
        detail: err.message,
        url,
      });
    }
  });

  /**
   * Slow endpoint — no request timeout (Daloy requestTimeoutMs = 30s).
   * Caps at 120s so demos cannot hang forever.
   */
  app.get("/api/slow", (req, res) => {
    const ms = Math.min(Math.max(Number(req.query.ms) || 1000, 0), 120_000);
    setTimeout(() => {
      res.json({ ok: true, waitedMs: ms });
    }, ms);
  });

  /**
   * Settings merge — prototype / mass-assignment playground (no auth).
   */
  app.get("/api/settings", (_req, res) => {
    res.json({ settings: db.settings });
  });

  app.put("/api/settings", (req, res) => {
    unsafeDeepMerge(db.settings, req.body || {});
    res.json({ settings: db.settings });
  });

  /**
   * Echo endpoint — reflects input (XSS stored/reflected fodder + headerless).
   */
  app.get("/api/echo", (req, res) => {
    const msg = String(req.query.msg || "");
    // Reflects raw HTML with text/html — XSS if opened in a browser.
    res.type("html").send(`<html><body><h1>Echo</h1><div>${msg}</div></body></html>`);
  });

  /**
   * Crash endpoint — stack traces in JSON (prod error redaction missing).
   */
  app.get("/api/boom", (_req, res) => {
    try {
      throw new Error("Simulated handler failure for demo");
    } catch (err) {
      res.status(500).json({
        error: err.message,
        stack: err.stack,
      });
    }
  });

  // Global error handler with stack leakage.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({
      error: err.message || "Internal error",
      stack: err.stack,
      type: err.type,
      limit: err.limit,
    });
  });

  app.use((req, res) => {
    res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
  });

  return { app, jwtSecret: secret, db };
}

export { createApp, JWT_SECRET, BODY_LIMIT };
