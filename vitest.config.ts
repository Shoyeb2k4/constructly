import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    // `mobile/src` is application code too — the native bootstrap, the deep-link
    // delivery and the router all live there. It was outside the test scope, so
    // the Android-only paths (cold-start deep links among them) had nowhere to
    // be tested even in principle.
    include: ["src/**/*.test.{ts,tsx}", "mobile/src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` isn't resolvable under Vitest's export conditions; stub it.
      "server-only": path.resolve(__dirname, "./src/test/server-only.stub.ts"),
    },
  },
});
