import { test, expect, type Page } from "@playwright/test";
import { textCollisions, hasPageOverflow } from "./helpers/geometry";

/**
 * Geometry and navigation guarantees for the redesigned Contractor experience.
 *
 * These assert things unit tests cannot see: that laid-out text does not overlap
 * other text, that no surface scrolls the page sideways, and that every area of
 * the contractor record is reachable at every supported width.
 */

const CONTRACTOR = "/labor/contractors/c-pappu";

const WIDTHS = [
  { name: "mobile", width: 375, height: 812 },
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

for (const vp of WIDTHS) {
  test(`contractor detail: no text collisions or page overflow at ${vp.name} (${vp.width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(CONTRACTOR);
    await settle(page);

    // The reconciliation figures are the surface that collided: `grid-cols-2`
    // gave each label/amount pair ~160px, and MoneyText correctly refuses to
    // wrap, so amounts printed on top of the next column's label.
    const collisions = await textCollisions(page);
    expect(collisions, `overlapping text at ${vp.width}px:\n${collisions.join("\n")}`).toEqual([]);

    const overflows = await hasPageOverflow(page);
    expect(overflows, `page scrolls horizontally at ${vp.width}px`).toBe(false);
  });
}

test("every area of the contractor record is reachable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(CONTRACTOR);
  await settle(page);

  // Below `lg` the sections collapse into one grouped select rather than a
  // horizontally scrolling strip. History and Advance ledger were the two that
  // fell off the end of that strip with no affordance to reveal them.
  const sections = page.getByRole("combobox", { name: "Contractor sections" });
  await expect(sections).toBeVisible();
  await sections.click();

  for (const area of [
    "Overview",
    "Agreements",
    "Scope & Labour",
    "Rates",
    "Milestones",
    "Amendments",
    "Payments",
    "Reconciliation",
    "Advance ledger",
    "History",
  ]) {
    await expect(
      page.getByRole("option", { name: area }),
      `"${area}" is not reachable at 375px`,
    ).toBeVisible();
  }

  // And picking one actually changes the panel.
  await page.getByRole("option", { name: "Advance ledger" }).click();
  await expect(page.getByText(/A labour advance pre-pays future labour/)).toBeVisible();
});

test("contractor sections are keyboard operable on the desktop rail", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(CONTRACTOR);
  await settle(page);

  const overview = page.getByRole("tab", { name: "Overview" });
  await expect(overview).toBeVisible();
  await overview.focus();
  // Radix gives the rail roving focus and arrow-key movement; the vertical
  // layout must not cost that.
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("tab", { name: "Agreements" })).toBeFocused();
});

/** Move to a section, whichever control this width exposes. */
async function openSection(page: Page, name: string) {
  const tab = page.getByRole("tab", { name, exact: true });
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
  } else {
    await page.getByRole("combobox", { name: "Contractor sections" }).click();
    await page.getByRole("option", { name, exact: true }).click();
  }
  await page.waitForTimeout(500);
}

const SECTIONS = [
  "Overview",
  "Agreements",
  "Scope & Labour",
  "Rates",
  "Milestones",
  "Amendments",
  "Payments",
  "Reconciliation",
  "Advance ledger",
  "History",
];

for (const vp of WIDTHS) {
  test(`every contractor section lays out cleanly at ${vp.name} (${vp.width}px)`, async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(CONTRACTOR);
    await settle(page);

    for (const section of SECTIONS) {
      await openSection(page, section);

      const collisions = await textCollisions(page);
      expect(
        collisions,
        `"${section}" at ${vp.width}px has overlapping text:\n${collisions.join("\n")}`,
      ).toEqual([]);

      const overflows = await hasPageOverflow(page);
      expect(overflows, `"${section}" scrolls the page sideways at ${vp.width}px`).toBe(false);
    }
  });
}

test("the contractor list lays out cleanly at every width", async ({ page }) => {
  for (const vp of WIDTHS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/labor/contractors");
    await settle(page);

    const collisions = await textCollisions(page);
    expect(collisions, `contractor list at ${vp.width}px:\n${collisions.join("\n")}`).toEqual([]);

    const overflows = await hasPageOverflow(page);
    expect(overflows, `contractor list scrolls sideways at ${vp.width}px`).toBe(false);
  }
});

test("meaningful contractor information appears without scrolling past a screen of chrome", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(CONTRACTOR);
  await settle(page);

  // Before the redesign the first financial figure sat at y=828 on an 812px
  // viewport — literally a full screen of chrome before any information.
  const firstMoneyTop = await page.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find(
      (e) => e.children.length === 0 && /₹/.test(e.textContent ?? ""),
    );
    return el ? el.getBoundingClientRect().top + window.scrollY : Number.POSITIVE_INFINITY;
  });
  expect(firstMoneyTop, "first financial figure is below the fold").toBeLessThan(812);
});
