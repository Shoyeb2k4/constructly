import { test, expect, type Page } from "@playwright/test";
import { textCollisions, hasPageOverflow } from "./helpers/geometry";

/**
 * Geometry and state guarantees for the redesigned Labour surfaces.
 *
 * Attendance is entered on a phone, on site, repeatedly — so the checks that
 * matter are that nothing overlaps, nothing is clipped, and the thing you are
 * counting is still legible next to the control you count it with.
 */

const WIDTHS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1130, height: 800 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

const SURFACES = [
  { name: "attendance", path: "/labor" },
  { name: "summary", path: "/labor/summary" },
];

async function settle(page: Page) {
  await page
    .waitForFunction(() => document.documentElement.dataset.constructlyHydrated === "1", undefined, {
      timeout: 15_000,
    })
    .catch(() => {});
  await page.waitForTimeout(800);
}

for (const surface of SURFACES) {
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

test("labour type names are never clipped on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/labor");
  await settle(page);

  // The name identifies WHAT is being counted. Truncating it next to a stepper
  // leaves the operator adjusting a quantity they cannot identify.
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll("p, span")]
      .filter((el) => el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0)
      .map((el) => `${(el.textContent ?? "").trim()} (${el.clientWidth}/${el.scrollWidth}px)`),
  );
  expect(clipped, `clipped text at 375px:\n${clipped.join("\n")}`).toEqual([]);
});

test("attendance renders without a hydration mismatch", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Hydration failed|did not match/i.test(m.text())) {
      hydrationErrors.push(m.text().slice(0, 120));
    }
  });

  await page.goto("/labor");
  await settle(page);

  // The screen's data lives only in the browser, so the server rendered an
  // empty state while the client rendered the sheet — React discarded the tree
  // and re-rendered the branch on every single load.
  expect(hydrationErrors, hydrationErrors.join("\n")).toEqual([]);
  await expect(page.getByRole("toolbar", { name: "Attendance controls" })).toBeVisible();
});

test("the labour summary names unattributed labour without implying loss", async ({ page }) => {
  await page.goto("/labor/summary");
  await settle(page);

  await expect(page.getByText("Not assigned to a contractor")).toBeVisible();
  await expect(page.getByText("Attendance value").first()).toBeVisible();
  // Never "due" or "payable": those are agreement concepts, computed elsewhere.
  await expect(page.getByText(/^Due$|^Payable$/)).toHaveCount(0);
});
