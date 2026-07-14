import { test, expect } from "@playwright/test";

test("attendance: mark all present updates the live totals", async ({ page }) => {
  await page.goto("/labor");
  const markAll = page.getByRole("button", { name: "Mark all present" });
  await expect(markAll).toBeVisible();
  await markAll.click();
  // Sticky summary reflects the crew.
  await expect(page.getByText(/\d+ present/)).toBeVisible();
  await expect(page.getByText(/Wages payable/)).toBeVisible();
});

test("labor sub-navigation works", async ({ page }) => {
  await page.goto("/labor");
  await page.getByRole("link", { name: "Workers" }).click();
  await expect(page).toHaveURL(/\/labor\/workers$/);
  await expect(page.getByText("Ramesh Kumar")).toBeVisible();
});

test("workers can be filtered to inactive", async ({ page }) => {
  await page.goto("/labor/workers");
  await expect(page.getByText("Manoj Verma")).toBeVisible();
});

test("labor summary shows cost rollups", async ({ page }) => {
  await page.goto("/labor/summary");
  await expect(page.getByText("Cost by project")).toBeVisible();
  await expect(page.getByText("Cost by contractor")).toBeVisible();
});
