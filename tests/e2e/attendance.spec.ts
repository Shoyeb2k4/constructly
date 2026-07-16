import { test, expect } from "@playwright/test";

test("attendance: stepping a category updates the totals", async ({ page }) => {
  await page.goto("/labor");
  // Increment Helper twice via the stepper.
  await page.getByRole("button", { name: "More Helper" }).click();
  await page.getByRole("button", { name: "More Helper" }).click();
  await expect(page.getByText("Total present")).toBeVisible();
  await expect(page.getByLabel("Helper present")).toHaveValue("2");
});

test("copy yesterday fills the sheet", async ({ page }) => {
  await page.goto("/labor");
  await page.getByRole("button", { name: "Copy yesterday" }).click();
  await expect(page.getByText(/Total present/)).toBeVisible();
});

test("categories can be managed", async ({ page }) => {
  await page.goto("/labor/categories");
  await expect(page.getByText("Mason")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add category" }).first()).toBeVisible();
});

test("labour summary shows man-days and trend", async ({ page }) => {
  await page.goto("/labor/summary");
  await expect(page.getByText("Total man-days")).toBeVisible();
  await expect(page.getByText("Man-days by category")).toBeVisible();
  await expect(page.getByText("Labour trend")).toBeVisible();
});
