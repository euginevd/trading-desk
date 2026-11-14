import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The api runs on 127.0.0.1:8000 (decision 10); the dev server proxies /api to it, so no CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", rewrite: (path) => path.replace(/^\/api/, "") },
    },
  },
  test: { environment: "jsdom", setupFiles: ["src/test-setup.ts"] },
});
