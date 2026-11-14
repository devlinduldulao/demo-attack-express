/**
 * VaultPay rebuilt on DaloyJS — the "after" half of the demo.
 *
 * Same routes, same seed data (../server/db.js), same virtual files
 * (../server/vfs.js), same unsafe merge helper (../server/merge.js) and the
 * SAME DEVELOPER MISTAKES as the Express app in ../server/app.js:
 *
 *   - no auth hook on /api/users, /api/users/:id, /api/search, /api/settings
 *   - no ownership check on orders or on PUT /api/users/:id
 *   - no role check on /api/admin/stats
 *   - a debug endpoint that prints the signing secret
 *   - a file endpoint that joins user input, a proxy that fetches any URL,
 *     a redirect that goes anywhere
 *   - plain-text passwords, distinct login error messages
 *
 * PORT RULES (so the comparison is fair — nothing here is tuned to win):
 *
 *   1. Handlers return the SAME objects the Express handlers return
 *      (db.fullUser / db.dumpUser rows and all). Handler logic is copied.
 *   2. The app is set up the way `pnpm create daloy` scaffolds it: body limit,
 *      request timeout, requestId(), secureHeaders(), rateLimit(120/min), and
 *      `.strict()` request schemas. Nothing beyond the scaffold is added.
 *   3. DaloyJS will not register a route without a response contract. The
 *      developer wrote ONE public `User` schema (the same six fields the
 *      Express app's own `publicUser()` helper returns) and reused it wherever
 *      a user is returned. That is the single judgment call in this port.
 *   4. First-party helpers the developer would have to know about and reach
 *      for — requireRoles(), fetchGuard(), safeRedirect(),
 *      assertSafeRelativePath(), loginThrottle() — are OFF by default and only
 *      switched on with DALOY_OPT_IN=1, so a run shows what is default and
 *      what is opt-in separately.
 *   5. Ownership checks are not added in either mode. No framework knows who
 *      owns an order.
 */

import { z } from "zod";
import {
  App,
  SsrfBlockedError,
  assertSafeRelativePath,
  bearerAuth,
  createJwtSigner,
  createJwtVerifier,
  every,
  fetchGuard,
  loginThrottle,
  rateLimit,
  requestId,
  requireRoles,
  safeRedirect,
  secureHeaders,
} from "@daloyjs/core";
import db from "../server/db.js";
import { unsafeDeepMerge } from "../server/merge.js";
import { buildFiles, readUserFile } from "../server/vfs.js";

/**
 * Still hard-coded in the repo (same mistake as the Express app) — but it has
 * to be this long: DaloyJS refuses HS256 keys under 32 bytes in every
 * environment, so `supersecret123` cannot boot. Try it:
 *   JWT_SECRET=supersecret123 node server.js
 */
const DEFAULT_JWT_SECRET = "vaultpay-9f2c7a41d8e05b63c1a7f4e29d0b8c56-signing-key";
const JWT_AUDIENCE = "vaultpay-api";
const TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

/** The public user shape — the same six fields as db.publicUser(). */
const User = z.object({
  id: z.number(),
  email: z.string(),
  name: z.string(),
  role: z.string(),
  phone: z.string(),
  balance: z.number(),
});

const Order = z.object({
  id: z.number(),
  userId: z.number(),
  merchant: z.string(),
  amount: z.number(),
  status: z.string(),
  cardLast4: z.string(),
  createdAt: z.string(),
});

const Settings = z.object({
  theme: z.string(),
  notifications: z.boolean(),
  featureFlags: z.record(z.string(), z.boolean()),
});

const ErrorBody = z.object({ error: z.string() });
const IdParams = z.object({ id: z.coerce.number() }).strict();

const text = (body, status = 200, type = "text/plain; charset=utf-8") =>
  new Response(body, { status, headers: { "content-type": type } });

/**
 * @param {{ jwtSecret?: string, optIn?: boolean, env?: "production"|"development"|"test" }} [opts]
 */
export function createApp(opts = {}) {
  const secret = opts.jwtSecret || process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
  const optIn = opts.optIn ?? process.env.DALOY_OPT_IN === "1";
  const env = opts.env || (process.env.NODE_ENV === "development" ? "development" : "production");
  const key = new TextEncoder().encode(secret);

  // Throws right here on a weak secret — before the server ever listens.
  const signer = createJwtSigner({ alg: "HS256", key, maxLifetimeSeconds: TOKEN_LIFETIME_SECONDS, env });
  // In production DaloyJS refuses a verifier with no audience, so one is set.
  const verifier = createJwtVerifier({ algorithms: ["HS256"], key, audience: JWT_AUDIENCE, env });

  // The developer backed up the live signing key next to the public files.
  const files = buildFiles(secret);

  const signToken = (user) =>
    signer.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      aud: JWT_AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS,
    });

  // Scaffold defaults (packages/create-daloy/templates/node-basic).
  const app = new App({
    title: "VaultPay API",
    version: "1.0.0",
    env,
    bodyLimitBytes: 1024 * 1024,
    requestTimeoutMs: 5_000,
  });
  app.use(requestId());
  app.use(secureHeaders());
  app.use(rateLimit({ windowMs: 60_000, max: 120 }));

  // Authn: "is this a token we signed?" — and nothing more, as in the Express app.
  const requireAuth = bearerAuth({
    validate: async (token) => {
      try {
        const { payload } = await verifier.verify(token);
        return { sub: payload.sub, claims: payload };
      } catch {
        return false;
      }
    },
  });
  const protectedRoute = { auth: { scheme: "bearer" }, hooks: requireAuth };

  // OPT-IN helpers (DALOY_OPT_IN=1). Each is one line the developer must add.
  const adminRoute = optIn
    ? { auth: { scheme: "bearer" }, hooks: every(requireAuth, requireRoles(["admin"], { claim: "role" })) }
    : protectedRoute;
  const loginRoute = optIn ? { hooks: loginThrottle() } : {};
  const outboundFetch = optIn ? fetchGuard() : fetch;

  app.get(
    "/",
    {
      responses: {
        200: {
          body: z.object({
            name: z.string(),
            version: z.string(),
            message: z.string(),
            docs: z.record(z.string(), z.string()),
          }),
        },
      },
    },
    () => ({
      status: 200,
      body: {
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
          reset: "POST /api/demo/reset",
        },
      },
    })
  );

  app.get(
    "/api/health",
    {
      responses: {
        200: {
          body: z.object({
            ok: z.boolean(),
            service: z.string(),
            framework: z.string(),
            optIn: z.boolean(),
            time: z.string(),
          }),
        },
      },
    },
    () => ({
      status: 200,
      body: {
        ok: true,
        service: "vaultpay-api",
        framework: optIn ? "DaloyJS + opt-in helpers" : "DaloyJS (scaffold defaults)",
        optIn,
        time: new Date().toISOString(),
      },
    })
  );

  /** Re-seed in-memory DB. Does NOT reset rate-limit counters. */
  app.post(
    "/api/demo/reset",
    {
      responses: {
        200: { body: z.object({ ok: z.boolean(), message: z.string() }) },
        404: { body: ErrorBody },
      },
    },
    ({ request }) => {
      const resetToken = process.env.DEMO_RESET_TOKEN || "";
      if (resetToken && request.headers.get("x-vaultpay-reset") !== resetToken) {
        return { status: 404, body: { error: "Not found" } };
      }
      db.reset();
      return { status: 200, body: { ok: true, message: "demo state re-seeded" } };
    }
  );

  app.post(
    "/api/auth/login",
    {
      ...loginRoute,
      request: { body: z.object({ email: z.string(), password: z.string() }).strict() },
      responses: {
        200: { body: z.object({ token: z.string(), user: User, message: z.string() }) },
        401: { body: ErrorBody },
      },
    },
    async ({ body }) => {
      const user = db.users.find((u) => u.email === body.email);
      if (!user) return { status: 401, body: { error: "No account for that email" } };
      if (user.password !== body.password) return { status: 401, body: { error: "Incorrect password" } };
      return {
        status: 200,
        body: {
          token: await signToken(user),
          user: db.publicUser(user),
          message: "Welcome back! Your session is secured with JWT.",
        },
      };
    }
  );

  app.post(
    "/api/auth/register",
    {
      request: {
        body: z.object({ email: z.string(), password: z.string(), name: z.string() }).strict(),
      },
      responses: {
        201: { body: z.object({ token: z.string(), user: User }) },
        409: { body: ErrorBody },
      },
    },
    async ({ body }) => {
      if (db.users.some((u) => u.email === body.email)) {
        return { status: 409, body: { error: "Email already registered" } };
      }
      const user = {
        id: db.bumpUserId(),
        email: body.email,
        password: body.password,
        name: body.name,
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
      return { status: 201, body: { token: await signToken(user), user: db.publicUser(user) } };
    }
  );

  app.get(
    "/api/me",
    { ...protectedRoute, responses: { 200: { body: z.object({ user: User }) }, 404: { body: ErrorBody } } },
    ({ state }) => {
      const user = db.users.find((u) => u.id === state.user.sub);
      if (!user) return { status: 404, body: { error: "User not found" } };
      return { status: 200, body: { user: db.publicUser(user) } };
    }
  );

  // MISTAKE (kept): no auth hook. Handler returns full rows, exactly like Express.
  app.get(
    "/api/users",
    { responses: { 200: { body: z.object({ users: z.array(User), total: z.number() }) } } },
    () => ({
      status: 200,
      body: { users: db.users.map((u) => db.fullUser(u)), total: db.users.length },
    })
  );

  // MISTAKE (kept): no auth hook, no ownership check.
  app.get(
    "/api/users/:id",
    {
      request: { params: IdParams },
      responses: { 200: { body: z.object({ user: User }) }, 404: { body: ErrorBody } },
    },
    ({ params }) => {
      const user = db.users.find((u) => u.id === params.id);
      if (!user) return { status: 404, body: { error: "User not found" } };
      return { status: 200, body: { user: db.fullUser(user) } };
    }
  );

  // MISTAKE (kept): any logged-in user may edit any user; raw merge into the row.
  // The request contract lists the three profile fields the edit form has.
  app.put(
    "/api/users/:id",
    {
      ...protectedRoute,
      request: {
        params: IdParams,
        body: z
          .object({
            name: z.string().optional(),
            phone: z.string().optional(),
            address: z.string().optional(),
          })
          .strict(),
      },
      responses: {
        200: { body: z.object({ message: z.string(), user: User }) },
        404: { body: ErrorBody },
      },
    },
    ({ params, body }) => {
      const user = db.users.find((u) => u.id === params.id);
      if (!user) return { status: 404, body: { error: "User not found" } };
      unsafeDeepMerge(user, body);
      user.id = params.id;
      return { status: 200, body: { message: "Profile updated", user: db.fullUser(user) } };
    }
  );

  // MISTAKE (kept): authn only — every login reads every order.
  app.get(
    "/api/orders",
    { ...protectedRoute, responses: { 200: { body: z.object({ orders: z.array(Order), total: z.number() }) } } },
    () => ({ status: 200, body: { orders: db.orders, total: db.orders.length } })
  );

  app.get(
    "/api/orders/:id",
    {
      ...protectedRoute,
      request: { params: IdParams },
      responses: { 200: { body: z.object({ order: Order }) }, 404: { body: ErrorBody } },
    },
    ({ params }) => {
      const order = db.orders.find((o) => o.id === params.id);
      if (!order) return { status: 404, body: { error: "Order not found" } };
      return { status: 200, body: { order } };
    }
  );

  app.post(
    "/api/orders",
    {
      ...protectedRoute,
      request: { body: z.object({ merchant: z.string(), amount: z.number() }).strict() },
      responses: { 201: { body: z.object({ order: Order }) } },
    },
    ({ body, state }) => {
      const user = db.users.find((u) => u.id === state.user.sub);
      const order = {
        id: db.bumpOrderId(),
        userId: state.user.sub,
        merchant: body.merchant,
        amount: body.amount,
        status: "pending",
        cardLast4: user ? String(user.cardNumber).slice(-4) : "0000",
        createdAt: new Date().toISOString(),
      };
      db.orders.push(order);
      return { status: 201, body: { order } };
    }
  );

  // MISTAKE (kept): no role check by default. Handler dumps raw rows, passwords included.
  app.get(
    "/api/admin/stats",
    {
      ...adminRoute,
      responses: {
        200: {
          body: z.object({
            users: z.number(),
            orders: z.number(),
            totalBalance: z.number(),
            accounts: z.array(User),
          }),
        },
      },
    },
    () => ({
      status: 200,
      body: {
        users: db.users.length,
        orders: db.orders.length,
        totalBalance: db.users.reduce((sum, u) => sum + Number(u.balance || 0), 0),
        accounts: db.users.map((u) => db.dumpUser(u)),
      },
    })
  );

  // MISTAKE (kept): the developer wanted to see the config, so the contract
  // lists every field — including the signing secret. A contract only strips
  // what you did not declare.
  app.get(
    "/api/debug/config",
    {
      responses: {
        200: {
          body: z.object({
            env: z.string(),
            runtime: z.string(),
            jwtSecret: z.string(),
            jwtAlgorithm: z.string(),
            bodyLimit: z.string(),
            database: z.string(),
            featureFlags: z.record(z.string(), z.boolean()),
            hint: z.string(),
          }),
        },
      },
    },
    () => ({
      status: 200,
      body: {
        env,
        runtime: "node",
        jwtSecret: secret,
        jwtAlgorithm: "HS256",
        bodyLimit: "1mb",
        database: "in-memory",
        featureFlags: {
          rateLimit: true,
          bodyLimitStrict: true,
          requestTimeout: true,
          secureHeaders: true,
          responseContracts: true,
          fieldAllowlist: true,
          loginThrottle: optIn,
          roleChecks: optIn,
          pathTraversalGuard: optIn,
          ssrfGuard: optIn,
          openRedirectGuard: optIn,
          ownershipChecks: false,
        },
        hint: "This endpoint should never exist in production.",
      },
    })
  );

  // MISTAKE (kept): no auth hook. Still searches SSN / address / internal notes.
  app.get(
    "/api/search",
    {
      request: { query: z.object({ q: z.string().optional() }) },
      responses: { 200: { body: z.object({ results: z.array(User), query: z.string().optional() }) } },
    },
    ({ query }) => {
      const q = String(query.q || "").toLowerCase();
      if (!q) return { status: 200, body: { results: [] } };
      const results = db.users
        .filter((u) =>
          [u.name, u.email, u.ssn, u.phone, u.address, u.internalNote].join(" ").toLowerCase().includes(q)
        )
        .map((u) => db.fullUser(u));
      return { status: 200, body: { results, query: q } };
    }
  );

  // MISTAKE (kept): user input joined onto a base directory with no containment.
  // Plain-text body, so the route must explicitly waive the response-body schema.
  app.get(
    "/api/files",
    {
      acknowledgeNoResponseBodySchema: true,
      request: { query: z.object({ name: z.string().optional() }) },
      responses: {
        200: { description: "File contents (text/plain)" },
        400: { body: z.object({ error: z.string(), example: z.string() }) },
        404: { body: z.object({ error: z.string(), path: z.string(), detail: z.string() }) },
      },
    },
    ({ query }) => {
      const name = String(query.name || "");
      if (!name) return { status: 400, body: { error: "name query required", example: "welcome.txt" } };
      if (optIn) assertSafeRelativePath(name); // OPT-IN: throws 400 on `..`, absolute paths, backslashes
      try {
        return text(readUserFile(name, files).content);
      } catch (err) {
        return {
          status: 404,
          body: { error: "File not found", path: err.path || name, detail: err.message },
        };
      }
    }
  );

  // MISTAKE (kept): redirect to whatever the query says.
  app.get(
    "/api/go",
    {
      acknowledgeNoResponseBodySchema: true,
      request: { query: z.object({ url: z.string().optional() }) },
      responses: { 302: { description: "Redirect" }, 303: { description: "Redirect (validated)" } },
    },
    ({ query }) => {
      const url = String(query.url || "/");
      if (optIn) return safeRedirect(url, { allowedPaths: ["/"], fallback: "/" }); // OPT-IN
      return new Response(null, { status: 302, headers: { location: url } });
    }
  );

  // MISTAKE (kept): server-side fetch of any URL the caller supplies.
  app.get(
    "/api/proxy",
    {
      acknowledgeNoResponseBodySchema: true,
      request: { query: z.object({ url: z.string().optional() }) },
      responses: {
        200: { description: "Upstream body (text/plain)" },
        400: { body: ErrorBody },
        422: { body: z.object({ error: z.string(), url: z.string() }) },
        502: { body: z.object({ error: z.string(), detail: z.string(), url: z.string() }) },
      },
    },
    async ({ query }) => {
      const url = String(query.url || "");
      if (!url) return { status: 400, body: { error: "url query required" } };
      try {
        // OPT-IN: outboundFetch is fetchGuard() — refuses loopback, private and metadata addresses.
        const upstream = await outboundFetch(url, {
          redirect: "follow",
          signal: AbortSignal.timeout(8000),
        });
        const body = await upstream.text();
        return text(body.slice(0, 50_000), upstream.status);
      } catch (err) {
        if (err instanceof SsrfBlockedError) {
          return { status: 422, body: { error: "Refused: destination is not allowed (SSRF guard)", url } };
        }
        return { status: 502, body: { error: "Upstream fetch failed", detail: err.message, url } };
      }
    }
  );

  // Same handler as Express: waits as long as it is told to.
  app.get(
    "/api/slow",
    {
      request: { query: z.object({ ms: z.string().optional() }) },
      responses: { 200: { body: z.object({ ok: z.boolean(), waitedMs: z.number() }) } },
    },
    async ({ query }) => {
      const ms = Math.min(Math.max(Number(query.ms) || 1000, 0), 120_000);
      await new Promise((resolve) => setTimeout(resolve, ms));
      return { status: 200, body: { ok: true, waitedMs: ms } };
    }
  );

  app.get(
    "/api/settings",
    { responses: { 200: { body: z.object({ settings: Settings }) } } },
    () => ({ status: 200, body: { settings: db.settings } })
  );

  // MISTAKE (kept): no auth hook; raw merge into shared settings.
  app.put(
    "/api/settings",
    {
      request: {
        body: z
          .object({
            theme: z.string().optional(),
            notifications: z.boolean().optional(),
            featureFlags: z.record(z.string(), z.boolean()).optional(),
          })
          .strict(),
      },
      responses: { 200: { body: z.object({ settings: Settings }) } },
    },
    ({ body }) => {
      unsafeDeepMerge(db.settings, body);
      return { status: 200, body: { settings: db.settings } };
    }
  );

  // MISTAKE (kept): user input interpolated into HTML.
  app.get(
    "/api/echo",
    {
      acknowledgeNoResponseBodySchema: true,
      request: { query: z.object({ msg: z.string().optional() }) },
      responses: { 200: { description: "HTML echo" } },
    },
    ({ query }) =>
      text(`<html><body><h1>Echo</h1><div>${String(query.msg || "")}</div></body></html>`, 200, "text/html; charset=utf-8")
  );

  // The Express app has a hand-written error handler that sends err.stack.
  // DaloyJS needs no error handler, so the developer never wrote one: it just throws.
  app.get(
    "/api/boom",
    { responses: { 200: { body: z.object({ ok: z.boolean() }) } } },
    () => {
      throw new Error("Simulated handler failure for demo");
    }
  );

  return { app, jwtSecret: secret, optIn, env, db };
}
