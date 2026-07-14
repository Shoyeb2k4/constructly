import { test, expect } from "@playwright/test";

test("dashboard loads in demo mode", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ }),
  ).toBeVisible();
  await expect(page.getByText("Active projects")).toBeVisible();
});

test("sidebar navigation works", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Projects" }).first().click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(
    page.getByRole("heading", { name: "No projects yet" }),
  ).toBeVisible();
});

test("style guide renders the design system", async ({ page }) => {
  await page.goto("/style");
  await expect(
    page.getByRole("heading", { name: "Blueprint design system" }),
  ).toBeVisible();
});
