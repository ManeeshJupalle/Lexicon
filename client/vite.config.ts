import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The proxy holds the AssemblyAI key and owns /ws. In dev the client is served from 5173
// and everything upstream is proxied to it, so the browser talks to one origin and the
// WebSocket URL is the same relative path in dev and in a built bundle.
const PROXY_TARGET = "http://localhost:8787";

export default defineConfig({
  // Explicit, because the config is loaded from the repo root by `npm run dev:client` and
  // Vite would otherwise take the root to be the working directory rather than client/.
  root: import.meta.dirname,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: PROXY_TARGET, ws: true },
      "/health": { target: PROXY_TARGET },
    },
    // The replay harness reads docs/fixtures/*.jsonl, which sits above the Vite root.
    // Dev-only; see src/dev/replay.ts.
    fs: { allow: [".."] },
  },
});
