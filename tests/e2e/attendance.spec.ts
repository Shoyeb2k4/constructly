import { test, expect, type Page } from "@playwright/test";

/**
 * Attendance is the highest-frequency screen in the product, so these cover the
 * operator's path rather than markup: pick a project, walk to a day, count
 * people, and see what it is worth — with the archived-contractor and
 * copy-previous-day rules stated rather than inferred.
 */

async function settle(page: Page) {
  await page
    .waitForFunction(() => document.documentElement.dataset.constructlyHydrated === "1", undefined, {
      timeout: 15_000,
    })
    .catch(() => {});
  await page.waitForTimeout(600);
}

test("stepping a labour type updates the sheet total", async ({ page }) => {
  await page.goto("/labor");
  await settle(page);
  await expect(page.getByLabel("Main Carpenter present")).toBeVisible();

  // Each press is half a day, so two presses is one full day.
  await page.getByRole("button", { name: "Half day more Main Carpenter" }).click();
  await page.getByRole("button", { name: "Half day more Main Carpenter" }).click();
  await expect(page.getByLabel("Main Carpenter present")).toHaveValue("1");
  await expect(page.getByText("Total present")).toBeVisible();
});

test("attendance groups labour under its contractor and values it", async ({ page }) => {
  await page.goto("/labor");
  await settle(page);
  await expect(page.getByLabel("Main Carpenter present")).toBeVisible();
  await expect(page.getByText("Ramesh Construction Crew")).toBeVisible();

  // "Attendance value", never "Due" or "Payable" — this is what the day's
  // quantity is worth at its snapshot rate, not an agreement liability.
  await expect(page.getByText("Attendance value")).toBeVisible();
  await expect(page.getByText(/Unsettled until a settlement runs/)).toBeVisible();
});

test("the day can be walked without opening a date picker", async ({ page }) => {
  await page.goto("/labor");
  await settle(page);

  const dateField = page.getByLabel("Attendance date");
  const start = await dateField.inputValue();

  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(dateField).not.toHaveValue(start);

  // Attendance is never recorded ahead of the work, so Next stops at today.
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(dateField).toHaveValue(start);
  await expect(page.getByRole("button", { name: "Next day" })).toBeDisabled();
});

test("copy previous day explains what it will do before doing it", async ({ page }) => {
  await page.goto("/labor");
  await settle(page);

  await page.getByRole("button", { name: "More attendance actions" }).click();
  await page.getByRole("menuitem", { name: /Copy yesterday/ }).click();

  // The rules the operation actually follows, stated up front.
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText(/most recent day that has attendance/)).toBeVisible();
  await expect(page.getByText(/archived since then are/)).toBeVisible();

  await page.getByRole("button", { name: "Copy previous day" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText("Total present")).toBeVisible();
});

test("quantity controls are reachable and named for every labour type", async ({ page }) => {
  await page.goto("/labor");
  await settle(page);

  for (const name of ["Main Carpenter", "Carpenter Helper"]) {
    await expect(page.getByRole("button", { name: `Half day more ${name}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Half day fewer ${name}` })).toBeVisible();
    await expect(page.getByLabel(`${name} present`)).toBeVisible();
  }
});

test("labour types are listed by trade group with default rates", async ({ page }) => {
  await page.goto("/labor/categories");
  await expect(page.getByText("Carpenter", { exact: true })).toBeVisible();
  await expect(page.getByText("Main Carpenter")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add group" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Add labour type" }).first()).toBeVisible();
});

test("labour summary breaks man-days down by contractor and by trade", async ({ page }) => {
  await page.goto("/labor/summary");
  await settle(page);
  await expect(page.getByRole("heading", { name: "Man-days by contractor" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Man-days by trade group" })).toBeVisible();
  await expect(page.getByText("Grand total")).toHaveCount(2);
});
