import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Automated accessibility gate. Scans the key surfaces with axe against
 * WCAG 2.1/2.2 A + AA rules. Runs in demo mode (no backend). This catches the
 * machine-checkable ~40% of WCAG; manual keyboard/SR checks are documented in
 * docs/testing.md.
 */

const PAGES: { name: string; path: string; ready: RegExp }[] = [
  { name: "dashboard", path: "/dashboard", ready: /Good (morning|afternoon|evening)/ },
  { name: "projects", path: "/projects", ready: /projects/i },
  { name: "procurement", path: "/procurement", ready: /procurement|purchase/i },
  { name: "vendors", path: "/vendors", ready: /vendor/i },
  { name: "labor", path: "/labor", ready: /attendance|labour|labor/i },
  { name: "reports", path: "/reports", ready: /report/i },
  { name: "settings", path: "/settings", ready: /settings/i },
];

for (const p of PAGES) {
  test(`a11y: ${p.name} has no serious/critical violations`, async ({ page }) => {
    await page.goto(p.path);
    await expect(page.getByText(p.ready).first()).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    const seriousOrWorse = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    // Attach details to the report on failure.
    if (seriousOrWorse.length) {
      console.error(
        `${p.name} violations:\n` +
          seriousOrWorse.map((v) => `- [${v.impact}] ${v.id}: ${v.help}`).join("\n"),
      );
    }
    expect(seriousOrWorse).toEqual([]);
  });
}

test("skip-to-content link works with keyboard", async ({ page }) => {
  await page.goto("/dashboard");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: /skip to content/i });
  await expect(skip).toBeFocused();
});
