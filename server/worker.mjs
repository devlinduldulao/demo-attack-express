/**
 * Cloudflare Workers entrypoint for VaultPay Express 5.
 *
 * Official pattern:
 * https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/
 *
 *   app.listen(PORT)
 *   export default httpServerHandler({ port: PORT })
 *
 * App is Express 5.x (package engines.node >= 24; see https://expressjs.com/en/guide/migrating-5/).
 *
 * Local:   npm run dev:cf
 * Deploy:  npm run deploy:cf
 */

import { httpServerHandler } from "cloudflare:node";
import { createApp } from "./app.js";

const PORT = 3000;

// Wrangler [vars] / secrets surface on process.env with nodejs_compat.
const jwtSecret = process.env.JWT_SECRET || "supersecret123";
process.env.CF_WORKER = process.env.CF_WORKER || "1";

const { app } = createApp({ jwtSecret });
app.listen(PORT);

export default httpServerHandler({ port: PORT });
