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
  // Demo mode seeds projects. This used to assert the empty state, which only
  // held because the browser bundle was built without the demo flag and so
  // fetched from a real, empty backend.
  await expect(page.getByText("Skyline Residency").filter({ visible: true }).first()).toBeVisible();
});

test("style guide renders the design system", async ({ page }) => {
  await page.goto("/style");
  await expect(
    page.getByRole("heading", { name: "Blueprint design system" }),
  ).toBeVisible();
});
