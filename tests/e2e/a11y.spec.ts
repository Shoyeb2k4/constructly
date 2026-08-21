import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Automated accessibility gate. Scans the key surfaces with axe against
 * WCAG 2.1/2.2 A + AA rules. Runs in demo mode (no backend). This catches the
 * machine-checkable ~40% of WCAG; manual keyboard/SR checks are documented in
 * docs/testing.md.
 *
 * BOTH THEMES, on purpose. This suite used to scan light only, and dark mode
 * carried undetected debt for exactly that reason: `--foreground-subtle` failed
 * AA in dark at 3.42:1 while the light scan was the only thing anyone watched.
 * Colour tokens are additionally held by src/app/token-contrast.test.ts, which
 * fails in milliseconds; this is the check that catches what COMPOSITION does to
 * them — an `opacity-70` on a card once dropped compliant token text to 2.78:1,
 * and no token test can see that.
 *
 * Rules are never disabled. A finding is either fixed or reported.
 */

const PAGES: { name: string; path: string; ready: RegExp }[] = [
  { name: "dashboard", path: "/dashboard", ready: /Good (morning|afternoon|evening)/ },
  { name: "projects", path: "/projects", ready: /Every site, from estimation to handover/ },
  {
    name: "project-detail",
    path: "/projects/10000000-0000-0000-0000-000000000001",
    ready: /Skyline Residency/,
  },
  { name: "procurement", path: "/procurement", ready: /Ordered value/ },
  {
    name: "po-detail",
    path: "/procurement/50000000-0000-0000-0000-000000000233",
    ready: /Line items/,
  },
  { name: "vendors", path: "/vendors", ready: /vendor/i },
  { name: "labor", path: "/labor", ready: /Total present|No active projects|Nothing to record/i },
  { name: "labor-summary", path: "/labor/summary", ready: /Total man-days|No labour recorded/i },
  { name: "labor-types", path: "/labor/categories", ready: /labour types/i },
  { name: "contractors", path: "/labor/contractors", ready: /contractor/i },
  // The redesign's reference surface: dense financial information, tabs,
  // tables, badges and a nav rail in one place.
  { name: "contractor-detail", path: "/labor/contractors/c-pappu", ready: /Pappu Contractor/ },
  // A cross-module money index: four instruments, a period control, filters,
  // a table with a card fallback and a detail sheet.
  { name: "payments", path: "/payments", ready: /Every payment recorded across Constructly/ },
  { name: "reports", path: "/reports", ready: /Analysis over the same figures/ },
  // The three report shapes: a wide transaction table, a ten-column financial
  // comparison, and a grouped table with a chart.
  { name: "report-payments", path: "/reports/payments", ready: /^Showing|Cash movement/ },
  {
    name: "report-contractor",
    path: "/reports/contractor-position",
    ready: /Agreement lifetime/,
  },
  { name: "report-labour", path: "/reports/labour-cost", ready: /Attendance value/ },
  { name: "settings", path: "/settings", ready: /Legal and tax identity/ },
  // The admin surfaces: dense forms, a permission editor with 97 checkboxes,
  // and the member list.
  { name: "settings-users", path: "/settings?section=users", ready: /Who can sign in/ },
  { name: "settings-roles", path: "/settings?section=roles", ready: /What each role may do/ },
];

async function scan(page: Page, path: string, ready: RegExp) {
  await page.goto(path);
  await expect(page.getByText(ready).first()).toBeVisible();
  await page
    .waitForFunction(() => document.documentElement.dataset.constructlyHydrated === "1", undefined, {
      timeout: 15_000,
    })
    .catch(() => {});

  // Wait for the design tokens to be LIVE before measuring colour. Under a
  // parallel run the stylesheet can still be arriving, and axe then samples
  // browser default colours and reports contrast failures that no user ever
  // sees — an intermittent red that teaches people to re-run instead of look.
  await page
    .waitForFunction(
      () =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--foreground-subtle")
          .trim().length > 0,
      undefined,
      { timeout: 15_000 },
    )
    .catch(() => {});

  // Let in-flight data settle too. Axe measures a FRAME; sampling one mid
  // transition reports colours that were never painted for a user.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(400);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

function report(name: string, theme: string, violations: Awaited<ReturnType<typeof scan>>) {
  if (!violations.length) return;
  console.error(
    `${name} [${theme}] violations:\n` +
      violations
        .map((v) => `- [${v.impact}] ${v.id} ×${v.nodes.length}: ${v.help}`)
        .join("\n"),
  );
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} theme`, () => {
    // next-themes runs on `system` by default, so emulating the media query is
    // what a real user's OS setting does — no test-only theme switch involved.
    test.use({ colorScheme: theme });

    for (const p of PAGES) {
      test(`a11y: ${p.name} has no serious/critical violations`, async ({ page }) => {
        const violations = await scan(page, p.path, p.ready);
        report(p.name, theme, violations);
        expect(violations).toEqual([]);
      });
    }

    test(`a11y: contractor detail at 375px has no serious/critical violations`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      const violations = await scan(page, "/labor/contractors/c-pappu", /Pappu Contractor/);
      report("contractor-detail@375", theme, violations);
      expect(violations).toEqual([]);
    });

    test(`a11y: dashboard at 375px has no serious/critical violations`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      const violations = await scan(page, "/dashboard", /Good (morning|afternoon|evening)/);
      report("dashboard@375", theme, violations);
      expect(violations).toEqual([]);
    });

    test(`a11y: procurement at 375px has no serious/critical violations`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      const violations = await scan(page, "/procurement", /Ordered value/);
      report("procurement@375", theme, violations);
      expect(violations).toEqual([]);
    });

    test(`a11y: project list at 375px has no serious/critical violations`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      const violations = await scan(page, "/projects", /Every site, from estimation to handover/);
      report("projects@375", theme, violations);
      expect(violations).toEqual([]);
    });

    test(`a11y: roles editor at 375px has no serious/critical violations`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      // The section hints are `lg:block`, so a phone needs a different signal.
      const violations = await scan(page, "/settings?section=roles", /Roles & permissions/);
      report("settings-roles@375", theme, violations);
      expect(violations).toEqual([]);
    });

    test(`a11y: users at 375px has no serious/critical violations`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      const violations = await scan(page, "/settings?section=users", /Invite a member/);
      report("settings-users@375", theme, violations);
      expect(violations).toEqual([]);
    });

    test(`a11y: reports catalogue at 375px has no serious/critical violations`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      const violations = await scan(page, "/reports", /Analysis over the same figures/);
      report("reports@375", theme, violations);
      expect(violations).toEqual([]);
    });

    test(`a11y: payments report at 375px has no serious/critical violations`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      const violations = await scan(page, "/reports/payments", /^Showing|Cash movement/);
      report("report-payments@375", theme, violations);
      expect(violations).toEqual([]);
    });

    test(`a11y: payments at 375px has no serious/critical violations`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      const violations = await scan(
        page,
        "/payments",
        /Every payment recorded across Constructly/,
      );
      report("payments@375", theme, violations);
      expect(violations).toEqual([]);
    });

    // Attendance is entered on a phone on site — the mobile layout is the real
    // one for this screen, not a fallback.
    test(`a11y: attendance at 375px has no serious/critical violations`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      const violations = await scan(page, "/labor", /Total present|No active projects|Nothing to record/i);
      report("attendance@375", theme, violations);
      expect(violations).toEqual([]);
    });
  });
}

test("skip-to-content link works with keyboard", async ({ page }) => {
  await page.goto("/dashboard");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: /skip to content/i });
  await expect(skip).toBeFocused();
});
