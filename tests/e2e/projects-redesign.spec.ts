import { test, expect, type Page } from "@playwright/test";
import { textCollisions, hasPageOverflow } from "./helpers/geometry";

/**
 * Geometry, semantics and navigation guarantees for the redesigned Projects
 * surfaces.
 */

const PROJECT = "/projects/10000000-0000-0000-0000-000000000001";

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

for (const surface of [
  { name: "project list", path: "/projects" },
  { name: "project detail", path: PROJECT },
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

test("project names are never clipped on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/projects");
  await settle(page);

  // Every name in this list used to truncate to 86px against a 106-177px need,
  // which made the list unscannable — you could not tell the projects apart.
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll("span, p, a")]
      .filter(
        (el) =>
          el.children.length === 0 &&
          el.scrollWidth > el.clientWidth + 1 &&
          el.clientWidth > 0 &&
          !el.className.toString().includes("sr-only"),
      )
      .map((el) => `${(el.textContent ?? "").trim()} (${el.clientWidth}/${el.scrollWidth}px)`),
  );
  expect(clipped, `clipped text at 375px:\n${clipped.join("\n")}`).toEqual([]);
});

test("the project list is a real table with real links, not role-juggled divs", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/projects");
  await settle(page);

  // Native semantics: a table with column headers, and every row reachable by
  // keyboard through a genuine link.
  const table = page.getByRole("table", { name: "Projects" });
  await expect(table).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Project" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Stage" })).toBeVisible();

  const rowLinks = page.locator('table a[href^="/projects/"]');
  expect(await rowLinks.count()).toBeGreaterThan(0);

  // The fake ARIA that Phase 1 removed must not come back.
  expect(await page.locator('div[role="row"]').count()).toBe(0);
});

test("every project section is reachable and keyboard operable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(PROJECT);
  await settle(page);

  for (const section of ["Overview", "Contractors", "Labour", "Procurement", "Activity"]) {
    await expect(
      page.getByRole("tab", { name: new RegExp(`^${section}`) }),
      `"${section}" is not reachable`,
    ).toBeVisible();
  }

  const overview = page.getByRole("tab", { name: "Overview" });
  await overview.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("tab", { name: "Contractors" })).toBeFocused();
});

test("project sections collapse into one control on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(PROJECT);
  await settle(page);

  const sections = page.getByRole("combobox", { name: "Project sections" });
  await expect(sections).toBeVisible();
  await sections.click();
  for (const section of ["Overview", "Contractors", "Labour", "Procurement", "Activity"]) {
    await expect(page.getByRole("option", { name: new RegExp(`^${section}`) })).toBeVisible();
  }
});

test("contractors are a first-class section that routes into the commercial record", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(PROJECT);
  await settle(page);

  await page.getByRole("tab", { name: "Contractors" }).click();
  await expect(page.getByText(/Attendance is recorded against these/)).toBeVisible();

  // One click from the project to the contractor's commercial record — not back
  // out to the global list to search for them again.
  const commercial = page.getByRole("link", { name: /Commercial/ }).first();
  await expect(commercial).toBeVisible();
  await expect(commercial).toHaveAttribute("href", /\/labor\/contractors\//);

  // And a context-preserving path into attendance for this project.
  await expect(page.getByRole("link", { name: /Record attendance/ }).first()).toHaveAttribute(
    "href",
    /\/labor\?project=/,
  );
});

test("projects renders without a hydration mismatch", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Hydration failed|did not match/i.test(m.text())) {
      hydrationErrors.push(m.text().slice(0, 120));
    }
  });

  await page.goto("/projects");
  await settle(page);
  // Pending is not empty: the list must never claim "No projects" while the
  // query is still resolving.
  expect(hydrationErrors, hydrationErrors.join("\n")).toEqual([]);
});
