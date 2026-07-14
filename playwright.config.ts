import { defineConfig, devices } from "@playwright/test";

/**
 * E2E harness. Runs against the app in demo mode (no backend required), so
 * smoke tests pass in CI without Supabase. `npx playwright install chromium`
 * once before the first run.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { CONSTRUCTLY_DEMO: "1" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
