import { test, expect } from "@playwright/test";

test("dashboard shows real KPIs and widgets", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), /})).toBeVisible();
  await expect(page.getByText("Active projects")).toBeVisible();
  await expect(page.getByText("Budget used")).toBeVisible();
  await expect(page.getByText("Spend trend")).toBeVisible();
  await expect(page.getByText("Cost split")).toBeVisible();
  await expect(page.getByText("Needs attention")).toBeVisible();
  await expect(page.getByText("Recent activity")).toBeVisible();
});

test("KPI cards drill down to their module", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("link", { name: /Pending approvals/ }).click();
  await expect(page).toHaveURL(/\/procurement$/);
});

test("quick actions are present", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: "Record attendance" })).toBeVisible();
});
