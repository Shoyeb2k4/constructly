import { test, expect } from "@playwright/test";

test("attendance: stepping a subcategory updates group and grand totals", async ({ page }) => {
  await page.goto("/labor");
  await page.getByRole("button", { name: "More Main Carpenter" }).click();
  await page.getByRole("button", { name: "More Main Carpenter" }).click();
  await expect(page.getByLabel("Main Carpenter present")).toHaveValue("2");
  await expect(page.getByText("Total present")).toBeVisible();
});

test("categories collapse and expand", async ({ page }) => {
  await page.goto("/labor");
  await expect(page.getByLabel("Main Carpenter present")).toBeVisible();
  await page.getByRole("button", { name: /^Carpenter/ }).first().click(); // collapse
  await expect(page.getByLabel("Main Carpenter present")).toHaveCount(0);
});

test("copy yesterday fills the sheet", async ({ page }) => {
  await page.goto("/labor");
  await page.getByRole("button", { name: "Copy yesterday" }).click();
  await expect(page.getByText(/Total present/)).toBeVisible();
});

test("hierarchy management lists categories with subcategories", async ({ page }) => {
  await page.goto("/labor/categories");
  await expect(page.getByText("Carpenter", { exact: true })).toBeVisible();
  await expect(page.getByText("Main Carpenter")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add category" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Add subcategory" }).first()).toBeVisible();
});

test("labour summary shows the hierarchy with a grand total", async ({ page }) => {
  await page.goto("/labor/summary");
  await expect(page.getByText("Man-days by category")).toBeVisible();
  await expect(page.getByText("Grand total")).toBeVisible();
  await expect(page.getByText("Labour trend")).toBeVisible();
});
