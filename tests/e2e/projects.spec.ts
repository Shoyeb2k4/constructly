import { test, expect } from "@playwright/test";

/**
 * The list renders a table on wide screens and a card list below `md`; both are
 * in the DOM, one hidden by CSS. These therefore scope to the VISIBLE instance —
 * `getByText(...).first()` picks whichever comes first in document order, which
 * is the hidden one at the default viewport.
 */
const visibleText = (page: import("@playwright/test").Page, text: string) =>
  page.getByText(text).filter({ visible: true }).first();

test("projects list renders seeded projects", async ({ page }) => {
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(visibleText(page, "Skyline Residency")).toBeVisible();
});

test("opening a project shows its detail", async ({ page }) => {
  await page.goto("/projects");
  // Rows navigate through a real link, so no hydration wait is needed for the
  // click to land — but the row still has to be present.
  await expect(page.locator("html[data-constructly-hydrated='1']")).toBeAttached();
  await visibleText(page, "Skyline Residency").click();
  await expect(page).toHaveURL(/\/projects\/[\w-]+$/);
  await expect(page.getByRole("heading", { name: "Skyline Residency" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Overview/ })).toBeVisible();
});

test("switching to the board shows lifecycle columns", async ({ page }) => {
  await page.goto("/projects");
  await page.getByRole("button", { name: "Board view" }).click();
  await expect(page.getByText("Construction", { exact: true }).first()).toBeVisible();
});

test("search filters the list", async ({ page }) => {
  await page.goto("/projects");
  await page.getByPlaceholder(/Search projects/).fill("Orion");
  await expect(visibleText(page, "Orion Tech Park")).toBeVisible();
  await expect(page.getByText("Skyline Residency")).toHaveCount(0);
});
