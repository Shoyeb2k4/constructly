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
    /**
     * A cold Turbopack compile of a heavy dynamic route legitimately takes
     * 30-50s on the first request — `/labor/contractors/[id]` was measured at
     * 47s cold and 0.9s warm. Playwright's 30s default counted that as a test
     * failure, so whichever spec happened to touch a route first failed, and
     * the failing set moved between runs.
     *
     * This changes no assertion: it waits for the dev server to answer instead
     * of calling a slow compile a bug. Everything after navigation keeps the
     * ordinary 5s expect timeout, so a genuinely missing element still fails
     * fast.
     */
    navigationTimeout: 90_000,
  },
  /** Per-test budget, raised in step with the navigation timeout above. */
  timeout: 120_000,
  webServer: {
    command: "npm run dev:demo",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
