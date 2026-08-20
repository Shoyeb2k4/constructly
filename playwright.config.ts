import { defineConfig, devices } from "@playwright/test";

/**
 * E2E harness. Runs against the app in demo mode (no backend required), so
 * smoke tests pass in CI without Supabase. `npx playwright install chromium`
 * once before the first run.
 *
 * The server is started through the canonical `dev:demo` script rather than by
 * setting flags here. Setting only `CONSTRUCTLY_DEMO` (as this config used to)
 * puts the run in demo's split-brain state: the SERVER renders demo data while
 * the browser bundle, which never receives an unprefixed variable, falls
 * through to real server actions. Owning the environment in one place —
 * scripts/demo-env.mjs — is what stops that recurring.
 */
const PORT = process.env.PORT ?? "3100";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev:demo",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
