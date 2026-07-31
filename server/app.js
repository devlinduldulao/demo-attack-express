/**
 * VaultPay Express 5 app factory.
 *
 * Default mode is INTENTIONALLY VULNERABLE (conference attack target).
 * Pass `hardened: true` or set `HARDENED=1` for the "green run" — same routes,
 * ownership checks, tight body limit, rate limit, secure headers, no debug leak.
 *
 * Finding kinds (see README): framework-gap | misconfig | junior-code.
 * Express 5 requires Node.js >= 18.
 */

import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import path from "node:path";
import db from "./db.js";
import { unsafeDeepMerge } from "./merge.js";
import { readUserFile, FILES } from "./vfs.js";

const JWT_SECRET = process.env.JWT_SECRET || "supersecret123";

/** Vulnerable demo body cap (misconfig vs express.json 100kb default). */
const BODY_LIMIT = process.env.BODY_LIMIT || "50mb";
const HARDENED_BODY_LIMIT = "100kb";

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
 * Stream JSON body parser (Workers-safe; avoids express.json → iconv-lite bundle break).
 * Explicit limit so the vulnerable story is "developer set 50mb", not "Express has none".
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

/** Contained file read for hardened mode (no `..` escape). */
function readPublicFileSafe(name) {
  const base = "data/public";
  const raw = String(name || "").replace(/\\/g, "/");
  if (!raw || raw.includes("\0") || raw.split("/").includes("..")) {
    const err = new Error("path not allowed");
    err.code = "EACCES";
    throw err;
  }
  const target = path.posix.normalize(path.posix.join(base, raw));
  if (!target.startsWith(base + "/") && target !== base) {
    const err = new Error("path not allowed");
    err.code = "EACCES";
    throw err;
  }
  const content = FILES[target];
  if (content === undefined) {
    const err = new Error(`ENOENT: ${target}`);
    err.code = "ENOENT";
    err.path = target;
    throw err;
  }
  return { path: target, content };
}

/** Detect deploy runtime for the debug banner (best-effort). */
function runtimeLabel() {
  if (process.env.VERCEL || process.env.VERCEL_ENV) {
    return "vercel-serverless";
  }
  if (process.env.CF_WORKER || process.env.WRANGLER || process.env.CLOUDFLARE_WORKER) {
    return "cloudflare-workers";
  }
  if (typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers") {
    return "cloudflare-workers";
  }
  return process.env.RUNTIME || "node";
}

/**
 * Simple per-IP login rate limit (hardened only). No external deps.
 * @returns {import("express").RequestHandler}
 */
function loginRateLimit() {
  const hits = new Map();
  const WINDOW_MS = 60_000;
  const MAX = 20;
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    let bucket = hits.get(ip);
    if (!bucket || now - bucket.start > WINDOW_MS) {
      bucket = { start: now, count: 0 };
      hits.set(ip, bucket);
    }
    bucket.count += 1;
    if (bucket.count > MAX) {
      return res.status(429).json({ error: "Too many login attempts. Try again later." });
    }
    next();
  };
}

/**
 * Create the Express application.
 * @param {{
 *   jwtSecret?: string,
 *   hardened?: boolean,
 *   demoGateToken?: string,
 * }} [opts]
 * @returns {{ app: import("express").Express, jwtSecret: string, db: typeof db, hardened: boolean }}
 */
function createApp(opts = {}) {
  const secret = opts.jwtSecret || JWT_SECRET;
  const hardened =
    opts.hardened === true ||
    process.env.HARDENED === "1" ||
    process.env.HARDENED === "true";
  const app = express();
  const bodyLimit = hardened ? HARDENED_BODY_LIMIT : BODY_LIMIT;

  // Optional demo gate: when DEMO_GATE_TOKEN is set, every request (except OPTIONS)
  // must send header X-VaultPay-Demo: <token>.
  const demoGate = process.env.DEMO_GATE_TOKEN || opts.demoGateToken || "";
  if (demoGate) {
    app.use((req, res, next) => {
      if (req.method === "OPTIONS") return next();
      if (req.get("x-vaultpay-demo") === demoGate) return next();
      return res.status(404).json({ error: "Not found" });
    });
  }

  if (hardened) {
    app.disable("x-powered-by");
    app.use((req, res, next) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
      res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
      if (req.secure || req.get("x-forwarded-proto") === "https") {
        res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
      }
      next();
    });
    // CORS still present for browser demos, but not origin: * with credentials fantasy.
    app.use(
      cors({
        origin: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-VaultPay-Demo"],
      })
    );
  } else {
    // Wide-open CORS — JUNIOR MISCONFIG (added cors package + origin "*").
    // Bare Express ships NO CORS middleware at all.
    app.use(
      cors({
        origin: "*",
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: [
          "Content-Type",
          "Authorization",
          "X-Requested-With",
          "X-VaultPay-Demo",
        ],
      })
    );
  }

  // Explicit body limit (Workers-safe custom parser). Hardened = 100kb; vulnerable = 50mb misconfig.
  app.use(jsonBody({ limit: bodyLimit }));

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
      if (hardened) {
        return res.status(401).json({ error: "Invalid or expired token." });
      }
      return res.status(401).json({
        error: "Invalid or expired token.",
        detail: err && err.message,
      });
    }
  }

  function requireRole(...roles) {
    return (req, res, next) => {
      if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      next();
    };
  }

  // -------------------------------------------------------------------------
  // Health / marketing
  // -------------------------------------------------------------------------
  app.get("/", (_req, res) => {
    res.json({
      name: "VaultPay API",
      version: "1.0.0",
      hardened,
      message: hardened
        ? "VaultPay API (hardened demo mode)"
        : "Secure online banking powered by JWT ✨",
      docs: {
        login: "POST /api/auth/login",
        me: "GET /api/me  (Bearer token required)",
        users: hardened ? "GET /api/users/:id (self or admin)" : "GET /api/users",
        orders: "GET /api/orders",
        files: "GET /api/files?name=welcome.txt",
        reset: "POST /api/demo/reset (vulnerable mode / gated)",
      },
    });
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "vaultpay-api",
      express: "5",
      hardened,
      time: new Date().toISOString(),
    });
  });

  /** Re-seed in-memory DB so warm isolates don't spoil the live reveal. */
  app.post("/api/demo/reset", (req, res) => {
    if (hardened) {
      return res.status(404).json({ error: "Not found" });
    }
    const resetToken = process.env.DEMO_RESET_TOKEN || "";
    if (resetToken && req.get("x-vaultpay-reset") !== resetToken) {
      return res.status(404).json({ error: "Not found" });
    }
    db.reset();
    res.json({ ok: true, message: "demo state re-seeded" });
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------
  const loginHandlers = hardened ? [loginRateLimit()] : [];
  app.post("/api/auth/login", ...loginHandlers, (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password required" });
    }

    const user = db.users.find((u) => u.email === email);
    if (hardened) {
      // Uniform error — no account enumeration.
      if (!user || user.password !== password) {
        return res.status(401).json({ error: "Invalid email or password" });
      }
    } else {
      if (!user) {
        return res.status(401).json({ error: "No account for that email" });
      }
      if (user.password !== password) {
        return res.status(401).json({ error: "Incorrect password" });
      }
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
  // Users / orders / admin
  // -------------------------------------------------------------------------
  if (hardened) {
    app.get("/api/users", requireAuth, requireRole("admin"), (_req, res) => {
      res.json({
        users: db.users.map((u) => db.publicUser(u)),
        total: db.users.length,
      });
    });

    app.get("/api/users/:id", requireAuth, (req, res) => {
      const id = Number(req.params.id);
      const user = db.users.find((u) => u.id === id);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (req.user.role !== "admin" && req.user.sub !== id) {
        return res.status(403).json({ error: "Forbidden" });
      }
      res.json({
        user: req.user.role === "admin" ? db.fullUser(user) : db.publicUser(user),
      });
    });

    app.put("/api/users/:id", requireAuth, (req, res) => {
      const id = Number(req.params.id);
      const user = db.users.find((u) => u.id === id);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (req.user.role !== "admin" && req.user.sub !== id) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const body = req.body || {};
      const allowed = ["name", "phone", "address"];
      for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(body, key) && typeof body[key] === "string") {
          user[key] = body[key];
        }
      }
      // Never accept role/balance/ssn/card from client in hardened mode.
      res.json({ message: "Profile updated", user: db.publicUser(user) });
    });

    app.get("/api/orders", requireAuth, (req, res) => {
      const mine = db.orders.filter((o) => o.userId === req.user.sub);
      res.json({ orders: mine, total: mine.length });
    });

    app.get("/api/orders/:id", requireAuth, (req, res) => {
      const order = db.orders.find((o) => o.id === Number(req.params.id));
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (req.user.role !== "admin" && order.userId !== req.user.sub) {
        return res.status(403).json({ error: "Forbidden" });
      }
      res.json({ order });
    });

    app.get("/api/admin/stats", requireAuth, requireRole("admin"), (_req, res) => {
      const totalBalance = db.users.reduce((sum, u) => sum + Number(u.balance || 0), 0);
      res.json({
        users: db.users.length,
        orders: db.orders.length,
        totalBalance,
        accounts: db.users.map((u) => db.publicUser(u)),
      });
    });

    // No public debug surface in hardened mode.
    app.get("/api/debug/config", (_req, res) => {
      res.status(404).json({ error: "Not found" });
    });

    app.get("/api/search", requireAuth, requireRole("admin"), (req, res) => {
      const q = String(req.query.q || "").toLowerCase();
      if (!q) return res.json({ results: [] });
      const results = db.users
        .filter((u) => {
          const haystack = [u.name, u.email].join(" ").toLowerCase();
          return haystack.includes(q);
        })
        .map((u) => db.publicUser(u));
      res.json({ results, query: q });
    });
  } else {
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
      const body = req.body || {};
      unsafeDeepMerge(user, body);
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
  }

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

  // -------------------------------------------------------------------------
  // Transport / file / proxy sinks
  // -------------------------------------------------------------------------
  app.get("/api/files", (req, res) => {
    const name = String(req.query.name || "");
    if (!name) {
      return res.status(400).json({ error: "name query required", example: "welcome.txt" });
    }
    try {
      const file = hardened ? readPublicFileSafe(name) : readUserFile(name);
      res.type("text/plain").send(file.content);
    } catch (err) {
      const status = err.code === "EACCES" ? 400 : 404;
      if (hardened) {
        return res.status(status).json({ error: "File not found" });
      }
      res.status(404).json({
        error: "File not found",
        path: err.path || name,
        detail: err.message,
      });
    }
  });

  app.get("/api/go", (req, res) => {
    const url = String(req.query.url || "/");
    if (hardened) {
      // Relative paths only.
      if (!url.startsWith("/") || url.startsWith("//") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
        return res.status(400).json({ error: "Only relative redirects allowed" });
      }
      return res.redirect(302, url);
    }
    res.redirect(302, url);
  });

  app.get("/api/proxy", async (req, res) => {
    if (hardened) {
      return res.status(404).json({ error: "Not found" });
    }
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

  app.get("/api/slow", (req, res) => {
    if (hardened) {
      return res.status(400).json({ error: "Slow endpoint disabled" });
    }
    const ms = Math.min(Math.max(Number(req.query.ms) || 1000, 0), 120_000);
    setTimeout(() => {
      res.json({ ok: true, waitedMs: ms });
    }, ms);
  });

  app.get("/api/settings", (req, res) => {
    if (hardened) {
      return requireAuth(req, res, () => {
        res.json({ settings: { theme: db.settings.theme, notifications: db.settings.notifications } });
      });
    }
    res.json({ settings: db.settings });
  });

  app.put("/api/settings", (req, res) => {
    if (hardened) {
      return requireAuth(req, res, () => {
        const body = req.body || {};
        if (typeof body.theme === "string") db.settings.theme = body.theme;
        if (typeof body.notifications === "boolean") db.settings.notifications = body.notifications;
        res.json({
          settings: { theme: db.settings.theme, notifications: db.settings.notifications },
        });
      });
    }
    unsafeDeepMerge(db.settings, req.body || {});
    res.json({ settings: db.settings });
  });

  app.get("/api/echo", (req, res) => {
    const msg = String(req.query.msg || "");
    if (hardened) {
      // text/plain + escaped — not an HTML XSS sink.
      res.type("text/plain").send(msg.replace(/[<>&]/g, (c) =>
        ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])
      ));
      return;
    }
    res.type("html").send(`<html><body><h1>Echo</h1><div>${msg}</div></body></html>`);
  });

  app.get("/api/boom", (_req, res) => {
    try {
      throw new Error("Simulated handler failure for demo");
    } catch (err) {
      if (hardened) {
        return res.status(500).json({ error: "Internal server error" });
      }
      res.status(500).json({
        error: err.message,
        stack: err.stack,
      });
    }
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (hardened) {
      return res.status(err.status || err.statusCode || 500).json({
        error: "Internal server error",
      });
    }
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

  return { app, jwtSecret: secret, db, hardened };
}

export { createApp, JWT_SECRET, BODY_LIMIT, HARDENED_BODY_LIMIT };
