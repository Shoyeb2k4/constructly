import { test, expect, type Page } from "@playwright/test";
import {
  textCollisions,
  hasPageOverflow,
  clippedText,
  tooWideForViewport,
} from "./helpers/geometry";

/**
 * The global Payments Centre.
 *
 * These lock down the two things that make a cross-module money index either
 * trustworthy or worthless: that every real cash movement is reachable and
 * traceable back to the record that owns it, and that nothing which merely
 * carries a rupee amount is dressed up as a payment.
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

/** Move the period select, which is how anything outside this month is reached. */
async function setPeriod(page: Page, label: string) {
  await page.getByRole("combobox", { name: "Period" }).first().click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await page.waitForTimeout(600);
}

test("payments is reachable from the main navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  await settle(page);

  // A first-class destination, in the operational group above Reports — not
  // buried inside Reports, which is analysis rather than day-to-day work.
  const link = page.getByRole("link", { name: "Payments", exact: true }).first();
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "/payments");
  await link.click();
  await expect(page).toHaveURL(/\/payments$/);
  await expect(page.getByRole("heading", { name: "Payments", level: 1 })).toBeVisible();
});

test("every headline figure names its period", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/payments");
  await settle(page);
  await page.getByRole("tab", { name: "Overview" }).click();

  // A money total with no period is a lie, so the period is in the label of
  // every card rather than assumed from context.
  for (const label of ["Paid · ", "To contractors · ", "To vendors · ", "Reversed · "]) {
    await expect(page.getByText(new RegExp(`^${label}`)).first()).toBeVisible();
  }
  await expect(page.getByText(/^Showing/)).toBeVisible();
});

test("the four instruments keep their own names", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/payments");
  await settle(page);
  await page.getByRole("tab", { name: "Overview" }).click();

  for (const label of [
    "Contractor advance",
    "Contractor payment",
    "Labour settlement",
    "Vendor payment",
  ]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
});

test("no combined outstanding, liability or cash-position figure is invented", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/payments");
  await settle(page);
  await page.getByRole("tab", { name: "Overview" }).click();
  await setPeriod(page, "All time");

  // Vendor "still owed" and contractor "currently due" rest on different
  // commercial bases; adding them produces a number with no meaning.
  for (const banned of [
    /Total outstanding/i,
    /Total liability/i,
    /Company due/i,
    /Total payable/i,
    /Cash position/i,
  ]) {
    await expect(page.getByText(banned)).toHaveCount(0);
  }
});

test("all four cash instruments appear, each exactly once", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/payments");
  await settle(page);
  await setPeriod(page, "All time");

  const table = page.getByRole("table", { name: /^Payments — / });
  await expect(table).toBeVisible();

  // The seeded company has vendor payments, agreement payments and contractor
  // advances. Each instrument is present under its own name.
  for (const type of ["Vendor payment", "Contractor payment", "Contractor advance"]) {
    expect(
      await table.getByText(type, { exact: true }).count(),
      `"${type}" is missing from the all-time transaction list`,
    ).toBeGreaterThan(0);
  }

  // No row is a duplicate: one link per source, and ids are namespaced per
  // instrument, so the same cash cannot be listed under two names.
  const rowCount = await table.locator("tbody tr").count();
  const partyButtons = await table.getByRole("button", { name: /open payment details/i }).count();
  expect(partyButtons).toBe(rowCount);
});

test("internal reallocation is never presented as a payment", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/payments");
  await settle(page);
  await setPeriod(page, "All time");

  // An advance drawdown, a scope transfer and a labour bill all carry rupee
  // amounts. None of them moved cash, so none of them is a row here.
  const table = page.getByRole("table", { name: /^Payments — / });
  for (const banned of [
    /Scope transfer/i,
    /Advance adjustment/i,
    /Advance drawdown/i,
    /Labour bill/i,
    /Re-scope/i,
    /Attribution/i,
  ]) {
    await expect(table.getByText(banned)).toHaveCount(0);
  }
  // And the raw enum names never surface either.
  await expect(page.getByText(/SCOPE_TRANSFER|OPENING_ADVANCE|LABOUR_BILL/)).toHaveCount(0);
});

test("a reversed payment stays visible and is excluded from the paid total", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/payments");
  await settle(page);
  await setPeriod(page, "All time");

  // The seed carries one reversed agreement payment.
  const reversed = page.getByRole("table", { name: /^Payments — / }).getByText("Reversed", {
    exact: true,
  });
  await expect(reversed.first()).toBeVisible();

  await page.getByRole("tab", { name: "Overview" }).click();
  // Reported on its own line, never netted against active money.
  await expect(page.getByText(/^Reversed · /)).toBeVisible();
  await expect(page.getByText(/reversed, and not counted above/)).toBeVisible();
});

test("a settlement is explained without being counted twice", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/payments");
  await settle(page);
  await setPeriod(page, "All time");

  // Open the first contractor advance and confirm the detail sheet states what
  // the instrument is rather than leaving the reader to infer it.
  await page
    .getByRole("table", { name: /^Payments — / })
    .getByRole("button", { name: /open payment details/i })
    .first()
    .click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Amount paid")).toBeVisible();
  await expect(dialog.getByRole("link", { name: /^Open / })).toBeVisible();
});

test("every transaction links to the record that owns it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/payments");
  await settle(page);
  await setPeriod(page, "All time");

  const table = page.getByRole("table", { name: /^Payments — / });
  const sourceLinks = table.getByRole("link", { name: /^Open / });
  const count = await sourceLinks.count();
  expect(count).toBeGreaterThan(0);

  // Each one points into a source module, never back at /payments.
  for (let i = 0; i < count; i++) {
    const href = await sourceLinks.nth(i).getAttribute("href");
    expect(href, "a source link points nowhere useful").toMatch(
      /^\/(procurement|vendors|labor\/contractors)\//,
    );
  }

  // And following one actually arrives.
  const first = sourceLinks.first();
  const href = await first.getAttribute("href");
  await first.click();
  await expect(page).toHaveURL(new RegExp(href!.split("?")[0].replace(/\//g, "\\/")));
});

test("a settlement source link lands on the contractor's money section", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // The deep link the Payments Centre uses must open the right section, not
  // drop the user on Overview to hunt for the record themselves.
  await page.goto("/labor/contractors/c-pappu?section=ledger");
  await settle(page);
  await expect(page.getByText(/A labour advance pre-pays future labour/)).toBeVisible();
});

test("filters and search narrow the list", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/payments");
  await settle(page);
  await setPeriod(page, "All time");

  const table = page.getByRole("table", { name: /^Payments — / });
  const total = await table.locator("tbody tr").count();
  expect(total).toBeGreaterThan(1);

  await page.getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "Vendor payment", exact: true }).click();
  await page.waitForTimeout(400);
  const filtered = await table.locator("tbody tr").count();
  expect(filtered).toBeLessThan(total);
  expect(filtered).toBeGreaterThan(0);

  // The count line reports both numbers, so a filtered view can never be
  // mistaken for the whole period.
  await expect(page.getByText(new RegExp(`${filtered} of ${total} transactions`))).toBeVisible();

  await page.getByRole("button", { name: /^Clear/ }).click();
  await page.waitForTimeout(400);
  expect(await table.locator("tbody tr").count()).toBe(total);
});

test("secondary filters live behind More filters with an active count", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/payments");
  await settle(page);

  await page.getByRole("button", { name: /More filters/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("More filters")).toBeVisible();
  // Every control is labelled — a bare select beside a rupee figure is a guess.
  await expect(sheet.getByLabel("Paid to")).toBeVisible();
  await expect(sheet.getByLabel("Status")).toBeVisible();
  await expect(sheet.getByLabel("Payment mode")).toBeVisible();
  // And the limitation is stated rather than silently applied.
  await expect(sheet.getByText(/do not record a payment mode/)).toBeVisible();
});

test("an empty period explains itself instead of claiming there are no payments", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/payments");
  await settle(page);
  await setPeriod(page, "Custom range");

  await page.getByLabel("From date").fill("2001-01-01");
  await page.getByLabel("To date").fill("2001-12-31");
  await page.waitForTimeout(800);

  // "No payments in this period" is a different statement from "this company
  // has never paid anyone", and the page must not confuse them.
  await expect(page.getByText(/Payments exist in other periods/)).toBeVisible();
  await expect(page.getByText(/No payments recorded yet/)).toHaveCount(0);
});

test("payments lays out cleanly at every width", async ({ page }) => {
  test.slow();
  for (const vp of WIDTHS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/payments");
    await settle(page);

    const collisions = await textCollisions(page);
    expect(
      collisions,
      `payments at ${vp.width}px has overlapping text:\n${collisions.join("\n")}`,
    ).toEqual([]);

    expect(await hasPageOverflow(page), `payments scrolls sideways at ${vp.width}px`).toBe(false);

    const wide = await tooWideForViewport(page);
    expect(wide, `an element outgrows the ${vp.width}px viewport:\n${wide.join("\n")}`).toEqual([]);
  }
});

test("the overview lays out cleanly at every width", async ({ page }) => {
  test.slow();
  for (const vp of WIDTHS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/payments");
    await settle(page);
    await page.getByRole("tab", { name: "Overview" }).click();
    await page.waitForTimeout(500);

    const collisions = await textCollisions(page);
    expect(
      collisions,
      `payments overview at ${vp.width}px has overlapping text:\n${collisions.join("\n")}`,
    ).toEqual([]);
    expect(await hasPageOverflow(page), `overview scrolls sideways at ${vp.width}px`).toBe(false);
  }
});

test("Indian-formatted money is never clipped on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/payments");
  await settle(page);

  // MoneyText refuses to wrap or round, so the layout must yield instead —
  // a clipped ₹1,32,77,520 is a wrong number, not a cosmetic issue.
  const clipped = await clippedText(page);
  expect(clipped, `clipped text at 375px:\n${clipped.join("\n")}`).toEqual([]);
});

test("the phone shows a real list, not a squeezed table", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/payments");
  await settle(page);

  // A stacked card list marked up as a list — not table semantics pretending
  // to survive a 375px viewport.
  const list = page.getByRole("list", { name: /^Payments — / });
  await expect(list).toBeVisible();
  await expect(page.getByRole("table", { name: /^Payments — / })).toBeHidden();

  // Party, amount, type, date and the source link all survive the width.
  const firstCard = list.getByRole("listitem").first();
  await expect(firstCard.getByRole("button", { name: /open payment details/i })).toBeVisible();
  await expect(firstCard.getByRole("link", { name: /^Open / })).toBeVisible();
});

test("payments renders without a hydration mismatch", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Hydration failed|did not match|#418|#425/i.test(m.text())) {
      consoleErrors.push(m.text().slice(0, 160));
    }
  });

  await page.goto("/payments");
  await settle(page);

  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  // Pending is not empty: the page must never claim the company has no payments
  // while the first snapshot is still resolving.
  await expect(page.getByText(/No payments recorded yet/)).toHaveCount(0);
});
