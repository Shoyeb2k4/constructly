import { test, expect, type Page } from "@playwright/test";
import { textCollisions, hasPageOverflow } from "./helpers/geometry";

/**
 * Dashboard as a command centre.
 *
 * The defect this locks down hardest is the one Phase 4 measured and Phase 5
 * traced: the attention card rendered 437px wide inside a 333px container at
 * 375px, because a grid item defaults to `min-width: auto` and refuses to shrink
 * below its content — an inner scroller that HID the items it exists to surface.
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
  await page.waitForTimeout(900);
}

/**
 * Dashboard as a command centre.
 *
 * The defect this locks down hardest is the one Phase 4 measured and Phase 5
 * traced: the attention card rendered 437px wide inside a 333px container at
 * 375px, because a grid item defaults to `min-width: auto` and refuses to shrink
 * below its content. That created an inner scroller which HID the very items the
 * section exists to surface.
 */

test("dashboard lays out cleanly at every width", async ({ page }) => {
  test.slow();
  for (const vp of WIDTHS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/dashboard");
    await settle(page);

    const collisions = await textCollisions(page);
    expect(
      collisions,
      `dashboard at ${vp.width}px has overlapping text:\n${collisions.join("\n")}`,
    ).toEqual([]);

    const overflows = await hasPageOverflow(page);
    expect(overflows, `dashboard scrolls sideways at ${vp.width}px`).toBe(false);
  }
});

test("no dashboard card outgrows its column on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/dashboard");
  await settle(page);

  // The 437px-in-333px attention card. A grid item's `min-width: auto` refuses
  // to shrink below its content, so an ordinary summary card became a hidden
  // horizontal scroller.
  const tooWide = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    return [...document.querySelectorAll("main *")]
      .filter((el) => el.getBoundingClientRect().width > viewport + 1)
      .map(
        (el) =>
          `${Math.round(el.getBoundingClientRect().width)}px: ${(el.textContent ?? "").trim().slice(0, 40)}`,
      );
  });
  expect(tooWide, `elements wider than the 375px viewport:\n${tooWide.join("\n")}`).toEqual([]);

  // And no clipped figures inside the cards.
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll("main p, main span")]
      .filter(
        (el) =>
          el.children.length === 0 &&
          el.scrollWidth > el.clientWidth + 1 &&
          el.clientWidth > 0 &&
          !el.className.toString().includes("truncate"),
      )
      .map((el) => `${(el.textContent ?? "").trim()} (${el.clientWidth}/${el.scrollWidth}px)`),
  );
  expect(clipped, `clipped text at 375px:\n${clipped.join("\n")}`).toEqual([]);
});

test("attention comes first and routes into the source module", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  await settle(page);

  const headings = await page.evaluate(() =>
    [...document.querySelectorAll("main h1, main h2, main h3")].map((h) =>
      (h.textContent ?? "").trim(),
    ),
  );
  // Attention is the first section after the greeting — it used to be the
  // bottom-left card of the last row, below three charts.
  expect(headings[0]).toMatch(/Good (morning|afternoon|evening)/);
  expect(headings[1]).toBe("Needs attention");

  // Each item says what happened and where to go.
  const first = page.getByRole("link", { name: /awaiting approval|overdue|% of budget/ }).first();
  await expect(first).toBeVisible();
  await expect(first).toHaveAttribute("href", /\/(procurement|projects)/);
});

test("dashboard uses each source module's own vocabulary and states the period", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  await settle(page);

  // Labour's word, with its timeframe and its caveat.
  await expect(page.getByText("Attendance value — today")).toBeVisible();
  await expect(page.getByText(/Unsettled until a settlement runs/)).toBeVisible();
  // Procurement's words.
  await expect(page.getByText("Ordered value").first()).toBeVisible();
  await expect(page.getByText(/Still owed/).first()).toBeVisible();
  await expect(page.getByText(/Not counted toward budget until approved/)).toBeVisible();

  // Never a generic collapse of distinct instruments.
  for (const banned of [/^Total liability$/, /^Company due$/, /^Total payable$/, /^Cash position$/]) {
    await expect(page.getByText(banned)).toHaveCount(0);
  }
});

test("dashboard routes into every source module", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  await settle(page);

  const nav = page.getByRole("navigation", { name: "Jump to a module" });
  for (const [label, href] of [
    ["All projects", "/projects"],
    ["Record attendance", "/labor"],
    ["Labour summary", "/labor/summary"],
    ["Contractors", "/labor/contractors"],
    ["Purchase orders", "/procurement"],
  ] as const) {
    await expect(nav.getByRole("link", { name: label })).toHaveAttribute("href", href);
  }
});

test("dashboard renders without a hydration mismatch", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Hydration failed|did not match/i.test(m.text())) {
      hydrationErrors.push(m.text().slice(0, 120));
    }
  });
  await page.goto("/dashboard");
  await settle(page);

  expect(hydrationErrors, hydrationErrors.join("\n")).toEqual([]);
  // Pending is not empty: the onboarding empty state must not flash for a
  // company that has projects.
  await expect(page.getByText(/Create your first project/)).toHaveCount(0);
});
