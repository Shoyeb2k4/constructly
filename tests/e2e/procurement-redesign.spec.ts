import { test, expect, type Page } from "@playwright/test";
import { textCollisions, hasPageOverflow } from "./helpers/geometry";

/**
 * Geometry, semantics and money-terminology guarantees for the redesigned
 * Procurement surfaces.
 *
 * The defect this locks down hardest is the one axe could not see: the purchase
 * order list was a CSS-grid pseudo-table whose rows were `onClick` divs with no
 * link, no role and no `tabIndex`.
 */

const WIDTHS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1130, height: 800 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

async function settle(page: Page) {
  await page
    .waitForFunction(() => document.documentElement.dataset.constructlyHydrated === "1", undefined, {
      timeout: 15_000,
    })
    .catch(() => {});
  await page.waitForTimeout(800);
}

async function firstPoHref(page: Page) {
  await page.goto("/procurement");
  await settle(page);
  const href = await page.locator('table a[href^="/procurement/"]').first().getAttribute("href");
  expect(href, "no purchase order link found").toBeTruthy();
  return href!;
}

for (const surface of [
  { name: "procurement list", path: "/procurement" },
  { name: "vendors", path: "/vendors" },
]) {
  test(`${surface.name} lays out cleanly at every width`, async ({ page }) => {
    test.slow();
    for (const vp of WIDTHS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(surface.path);
      await settle(page);

      const collisions = await textCollisions(page);
      expect(
        collisions,
        `${surface.name} at ${vp.width}px has overlapping text:\n${collisions.join("\n")}`,
      ).toEqual([]);

      const overflows = await hasPageOverflow(page);
      expect(overflows, `${surface.name} scrolls sideways at ${vp.width}px`).toBe(false);
    }
  });
}

test("purchase order detail lays out cleanly at every width", async ({ page }) => {
  test.slow();
  const href = await firstPoHref(page);
  for (const vp of WIDTHS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(href);
    await settle(page);

    const collisions = await textCollisions(page);
    expect(
      collisions,
      `PO detail at ${vp.width}px has overlapping text:\n${collisions.join("\n")}`,
    ).toEqual([]);
    const overflows = await hasPageOverflow(page);
    expect(overflows, `PO detail scrolls sideways at ${vp.width}px`).toBe(false);
  }
});

test("purchase orders are openable by keyboard through real links", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/procurement");
  await settle(page);

  // Native table semantics, and a genuine link per row. The previous grid had
  // `onClick` divs, so this list simply could not be operated by keyboard.
  await expect(page.getByRole("table", { name: "Purchase orders" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "PO / Vendor" })).toBeVisible();
  expect(await page.locator('table a[href^="/procurement/"]').count()).toBeGreaterThan(0);

  const link = page.locator('table a[href^="/procurement/"]').first();
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/procurement\/[\w-]+$/);
});

test("order state and payment state are shown as separate, non-colour-only facts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/procurement");
  await settle(page);

  // Both columns exist and both are labelled badges — an approved order can sit
  // unpaid, so one blended "state" would be a lie.
  await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Payment" })).toBeVisible();
  await expect(page.getByText(/Unpaid|Partially paid|Paid/).first()).toBeVisible();
});

test("procurement headline figures name what they mean", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/procurement");
  await settle(page);

  await expect(page.getByText("Awaiting approval")).toBeVisible();
  await expect(page.getByText("Ordered value")).toBeVisible();
  await expect(page.getByText("Paid against orders")).toBeVisible();
  // Never one ambiguous "Procurement cost" standing for all three.
  await expect(page.getByText(/^Procurement cost$/)).toHaveCount(0);
});

test("a purchase order separates ordered, paid and still owed", async ({ page }) => {
  const href = await firstPoHref(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(href);
  await settle(page);

  await expect(page.getByText("Grand total (ordered)")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Money" })).toBeVisible();
  await expect(page.getByText("Still owed")).toBeVisible();
  await expect(page.getByText(/Neither says anything about delivery/)).toBeVisible();
});

test("procurement renders without a hydration mismatch", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Hydration failed|did not match/i.test(m.text())) {
      hydrationErrors.push(m.text().slice(0, 120));
    }
  });
  await page.goto("/procurement");
  await settle(page);
  // Pending is not empty.
  expect(hydrationErrors, hydrationErrors.join("\n")).toEqual([]);
  await expect(page.getByText(/No purchase orders/)).toHaveCount(0);
});
