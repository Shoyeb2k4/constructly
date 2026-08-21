import { test, expect, type Page } from "@playwright/test";
import { textCollisions, hasPageOverflow, clippedText, tooWideForViewport } from "./helpers/geometry";

/**
 * The redesigned Reports centre.
 *
 * Reports is where a wrong number does the most damage, because it is the
 * surface people export and forward. So these check two things above all: that
 * every figure names the period it covers, and that the analysis surface never
 * invents a concept the operational modules do not have.
 */

const WIDTHS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1130, height: 800 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

/** Every report, so a layout regression cannot hide in an unvisited one. */
const REPORT_IDS = [
  "payments",
  "budget-vs-actual",
  "project-summary",
  "deadlines",
  "contractor-position",
  "contractor-settlements",
  "labour-cost",
  "labour-by-contractor",
  "procurement",
  "vendor-summary",
];

async function settle(page: Page) {
  await page
    .waitForFunction(() => document.documentElement.dataset.constructlyHydrated === "1", undefined, {
      timeout: 15_000,
    })
    .catch(() => {});
  await page.waitForTimeout(900);
}

async function setPeriod(page: Page, label: string) {
  await page.getByRole("combobox", { name: "Period" }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await page.waitForTimeout(700);
}

/* ── Catalogue ───────────────────────────────────────────────────────── */

test("the catalogue groups reports by the question they answer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/reports");
  await settle(page);

  // Money first — that is what people open Reports for.
  for (const group of ["Payments", "Projects", "Contractors", "Labour", "Procurement"]) {
    await expect(page.getByRole("heading", { name: group, exact: true })).toBeVisible();
  }

  // Every entry leads with a QUESTION, not a restatement of its own name.
  await expect(
    page.getByText("What money actually left the company, to whom, and for which project?"),
  ).toBeVisible();
  await expect(
    page.getByText("How many man-days were worked, and what were they worth, by trade?"),
  ).toBeVisible();

  // A grouped list, not nine identical cards.
  expect(await page.locator("section ul li a[href^='/reports/']").count()).toBe(REPORT_IDS.length);
});

test("every catalogue entry opens its report", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/reports");
  await settle(page);

  const links = page.locator("section ul li a[href^='/reports/']");
  const hrefs = await links.evaluateAll((els) => els.map((e) => e.getAttribute("href")!));
  expect(hrefs.length).toBe(REPORT_IDS.length);
  for (const id of REPORT_IDS) expect(hrefs).toContain(`/reports/${id}`);
});

/* ── Period semantics ────────────────────────────────────────────────── */

test("every report states the period its figures cover", async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const id of REPORT_IDS) {
    await page.goto(`/reports/${id}`);
    await settle(page);
    // Never a total with no period beside it.
    await expect(page.getByText(/^Showing/), `${id} does not state its period`).toBeVisible();
  }
});

test("a cumulative report says so instead of faking a month", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Reconciliation is cumulative by definition, so it takes no period control
  // and labels itself honestly rather than implying a monthly figure.
  await page.goto("/reports/contractor-position");
  await settle(page);
  await expect(page.getByText("Agreement lifetime").first()).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Period" })).toHaveCount(0);

  await page.goto("/reports/budget-vs-actual");
  await settle(page);
  await expect(page.getByText("Project lifetime").first()).toBeVisible();
});

test("changing the period changes the figures and the label together", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/reports/payments");
  await settle(page);

  await setPeriod(page, "All time");
  await expect(page.getByText("Showing All time")).toBeVisible();
  await expect(page.getByText(/^Paid · All time/)).toBeVisible();
  // The URL carries it, so the view is shareable and reproducible.
  await expect(page).toHaveURL(/period=ALL_TIME/);
});

/* ── Canonical vocabulary ────────────────────────────────────────────── */

test("the payments report keeps the Payments Centre's vocabulary", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/reports/payments");
  await settle(page);
  await setPeriod(page, "All time");

  // Scope to the table: below `md` the same rows also render as a hidden card
  // list, and an unscoped match resolves to those first.
  const table = page.getByRole("table").first();
  for (const label of ["Contractor advance", "Contractor payment", "Vendor payment"]) {
    await expect(
      table.getByText(label, { exact: true }).first(),
      `"${label}" is missing from the payments report`,
    ).toBeVisible();
  }
  // Internal reallocation is never dressed up as a payment.
  await expect(page.getByText(/Scope transfer|Advance drawdown|Advance adjustment/)).toHaveCount(0);
  await expect(page.getByText(/SCOPE_TRANSFER|OPENING_ADVANCE|LABOUR_BILL/)).toHaveCount(0);
});

test("the contractor report keeps Due and Ahead apart", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/reports/contractor-position");
  await settle(page);

  await expect(page.getByText(/Currently due/).first()).toBeVisible();
  await expect(page.getByText(/Paid ahead/).first()).toBeVisible();
  await expect(page.getByText(/never netted/).first()).toBeVisible();
  // No netted company-level position.
  await expect(page.getByText(/Net position|Net commercial|Company due/)).toHaveCount(0);
});

test("the labour report names attendance value and denies it is a payable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/reports/labour-cost");
  await settle(page);
  await setPeriod(page, "All time");

  await expect(page.getByText("Attendance value").first()).toBeVisible();
  await expect(page.getByText(/not a payable/)).toBeVisible();
});

test("the procurement report says nothing about delivery", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/reports/procurement");
  await settle(page);
  await setPeriod(page, "All time");

  await expect(page.getByText("Ordered value").first()).toBeVisible();
  await expect(page.getByText("Still owed").first()).toBeVisible();
  await expect(page.getByText(/records no goods receipt/)).toBeVisible();
});

test("no report invents an outstanding, liability or cash-position total", async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const id of ["payments", "budget-vs-actual", "contractor-position", "labour-cost"]) {
    await page.goto(`/reports/${id}`);
    await settle(page);
    for (const banned of [/Total liability/i, /Company due/i, /Cash position/i, /Total payable/i]) {
      await expect(page.getByText(banned), `${id} invented a total`).toHaveCount(0);
    }
  }
});

/* ── Tables, links and charts ────────────────────────────────────────── */

test("report rows are a real table with real links into the source record", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/reports/procurement");
  await settle(page);
  await setPeriod(page, "All time");

  await expect(page.getByRole("table").first()).toBeVisible();
  // No role-juggled divs anywhere in the analysis surface.
  expect(await page.locator('div[role="row"]').count()).toBe(0);

  const rowLink = page.locator('table a[href^="/procurement/"]').first();
  await expect(rowLink).toBeVisible();
  await rowLink.focus();
  await expect(rowLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/procurement\/[\w-]+$/);
});

test("a chart appears only where shape helps, and never hides the figures", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/reports/labour-cost");
  await settle(page);
  await setPeriod(page, "All time");

  const chart = page.getByRole("img", { name: /Man-days recorded per day/ });
  await expect(chart).toBeVisible();
  // The chart carries its own words, and the exact figures stay in the table.
  await expect(page.getByRole("heading", { name: /Man-days worked over the period/ })).toBeVisible();
  await expect(page.getByRole("table").first()).toBeVisible();

  // A report with no time dimension gets no chart rather than a decorative one.
  await page.goto("/reports/vendor-summary");
  await settle(page);
  await expect(page.getByRole("img", { name: /per day|by month/ })).toHaveCount(0);
});

/* ── Filters and exports ─────────────────────────────────────────────── */

test("filters narrow the report and are echoed for the export", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/reports/procurement");
  await settle(page);
  await setPeriod(page, "All time");

  const before = await page.locator("table tbody tr").count();
  await page.getByRole("combobox", { name: "Project" }).click();
  await page.getByRole("option").nth(1).click();
  await page.waitForTimeout(800);

  // The active filter is stated on screen, so the reader knows what they have.
  await expect(page.getByRole("list", { name: "Active filters" })).toBeVisible();
  const after = await page.locator("table tbody tr").count();
  expect(after).toBeLessThanOrEqual(before);
});

test("secondary filters sit behind More filters with an active count", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/reports/payments");
  await settle(page);

  await page.getByRole("button", { name: /More filters/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  // Each control is labelled — a bare select beside a rupee figure is a guess.
  await expect(sheet.getByText("Transaction type", { exact: true })).toBeVisible();
  await expect(sheet.getByText("Status", { exact: true })).toBeVisible();
  await expect(sheet.locator("#report-type")).toBeVisible();
  await expect(sheet.locator("#report-status")).toBeVisible();
  await expect(sheet.getByText(/never counted in a paid total/)).toBeVisible();
});

test("export controls are offered in all three formats", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/reports/payments");
  await settle(page);

  for (const fmt of ["Excel", "CSV", "PDF"]) {
    await expect(page.getByRole("button", { name: fmt, exact: true })).toBeVisible();
  }
});

/* ── Empty states ────────────────────────────────────────────────────── */

test("an empty period is not reported as a company with no history", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/reports/payments?period=CUSTOM&from=2001-01-01&to=2001-12-31");
  await settle(page);

  await expect(page.getByText(/Nothing in /)).toBeVisible();
  await expect(page.getByText(/records in other periods or scopes/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Show all time" })).toBeVisible();
});

/* ── Geometry ────────────────────────────────────────────────────────── */

test("the catalogue lays out cleanly at every width", async ({ page }) => {
  test.slow();
  for (const vp of WIDTHS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/reports");
    await settle(page);

    const collisions = await textCollisions(page);
    expect(collisions, `catalogue at ${vp.width}px:\n${collisions.join("\n")}`).toEqual([]);
    expect(await hasPageOverflow(page), `catalogue scrolls sideways at ${vp.width}px`).toBe(false);
  }
});

for (const id of ["payments", "contractor-position", "procurement", "labour-cost"]) {
  test(`the ${id} report lays out cleanly at every width`, async ({ page }) => {
    test.slow();
    for (const vp of WIDTHS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`/reports/${id}`);
      await settle(page);

      const collisions = await textCollisions(page);
      expect(collisions, `${id} at ${vp.width}px:\n${collisions.join("\n")}`).toEqual([]);
      expect(await hasPageOverflow(page), `${id} scrolls sideways at ${vp.width}px`).toBe(false);
      const wide = await tooWideForViewport(page);
      expect(wide, `${id} outgrows ${vp.width}px:\n${wide.join("\n")}`).toEqual([]);
    }
  });
}

test("Indian-formatted money is never clipped on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const id of ["payments", "contractor-position", "budget-vs-actual"]) {
    await page.goto(`/reports/${id}`);
    await settle(page);
    const clipped = await clippedText(page);
    expect(clipped, `${id} clips text at 375px:\n${clipped.join("\n")}`).toEqual([]);
  }
});

test("a phone gets a stacked list, not a squeezed ten-column table", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/reports/contractor-position");
  await settle(page);

  await expect(page.getByRole("list").first()).toBeVisible();
  await expect(page.getByRole("table").first()).toBeHidden();
});

/* ── Loading and hydration ───────────────────────────────────────────── */

test("reports render without a hydration mismatch or a flash of zero", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Hydration failed|did not match|#418|#425/i.test(m.text())) {
      errors.push(m.text().slice(0, 160));
    }
  });

  await page.goto("/reports/payments");
  await settle(page);
  expect(errors, errors.join("\n")).toEqual([]);
  // Pending is not empty: the page must never claim there is nothing to report
  // while the first result is still resolving.
  await expect(page.getByText(/No payments records yet/)).toHaveCount(0);
});
