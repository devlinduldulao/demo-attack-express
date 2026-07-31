/**
 * Vercel Serverless entry for VaultPay Express 5.
 *
 * Deploy from the server/ directory (same folder as package.json):
 *   cd server
 *   vercel --prod --yes
 *
 * Vercel invokes this as a single Node serverless function that mounts the
 * full Express app. In-memory DB resets on cold starts (expected for demos).
 *
 * Docs: https://vercel.com/docs/frameworks/backend/express
 */

import { createApp } from "../app.js";

const jwtSecret = process.env.JWT_SECRET || "supersecret123";

// Vercel sets VERCEL=1; make runtimeLabel() reliable.
process.env.VERCEL = process.env.VERCEL || "1";

const { app } = createApp({ jwtSecret });

export default app;
