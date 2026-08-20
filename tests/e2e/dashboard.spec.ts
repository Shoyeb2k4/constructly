import { test, expect } from "@playwright/test";

/**
 * These follow the command-centre hierarchy rather than the old six-card KPI
 * row: attention leads, then the operational pulse, then commercial context.
 * Budget now lives in the Budget health card rather than a headline tile.
 */

test("dashboard shows the command-centre sections", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: /Good (morning|afternoon|evening), / }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  await expect(page.getByText("Active projects")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Spend trend" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cost split" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Budget health" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();
});

test("headline metrics drill down to their module", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("link", { name: /Awaiting approval/ }).first().click();
  await expect(page).toHaveURL(/\/procurement$/);
});

test("quick actions are present", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: "Record attendance" }).first()).toBeVisible();
});
