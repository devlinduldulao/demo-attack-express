import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves from /<repo>/ when using project pages.
// Override at build time:  VITE_BASE=/my-repo/ pnpm build
const base = process.env.VITE_BASE || "./";

export default defineConfig({
  plugins: [react()],
  base,
  server: {
    port: 5173,
    proxy: {
      // Local dev convenience: SPA on :5173, API on :4000
      "/api": "http://localhost:4000",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
