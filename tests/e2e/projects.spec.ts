import { test, expect } from "@playwright/test";

test("projects list renders seeded projects", async ({ page }) => {
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByText("Skyline Residency").first()).toBeVisible();
});

test("opening a project shows its detail", async ({ page }) => {
  await page.goto("/projects");
  await page.getByText("Skyline Residency").first().click();
  await expect(page).toHaveURL(/\/projects\/[\w-]+$/);
  await expect(page.getByRole("heading", { name: "Skyline Residency" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Overview/ })).toBeVisible();
});

test("switching to the board shows lifecycle columns", async ({ page }) => {
  await page.goto("/projects");
  await page.getByRole("button", { name: "Board" }).click();
  await expect(page.getByText("Construction", { exact: true })).toBeVisible();
});

test("search filters the list", async ({ page }) => {
  await page.goto("/projects");
  await page.getByPlaceholder(/Search projects/).fill("Orion");
  await expect(page.getByText("Orion Tech Park")).toBeVisible();
  await expect(page.getByText("Skyline Residency")).toHaveCount(0);
});
