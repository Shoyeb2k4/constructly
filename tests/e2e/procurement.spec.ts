import { test, expect, type Page } from "@playwright/test";

/**
 * Procurement lists render a table on wide screens and a card list below `md`;
 * both are in the DOM, one hidden by CSS. These scope to the VISIBLE instance —
 * a bare `getByText` matches whichever comes first in document order, which is
 * the hidden one at the default viewport.
 */
const visibleText = (page: Page, text: string | RegExp) =>
  page.getByText(text).filter({ visible: true }).first();

test("procurement lists purchase orders with an approval inbox", async ({ page }) => {
  await page.goto("/procurement");
  await expect(page.getByRole("heading", { name: "Procurement" })).toBeVisible();
  await expect(visibleText(page, "PO-0231")).toBeVisible();
  await expect(page.getByRole("button", { name: "New purchase order" })).toBeVisible();
});

test("opening a purchase order shows its line items", async ({ page }) => {
  await page.goto("/procurement");
  await visibleText(page, "PO-0231").click();
  await expect(page).toHaveURL(/\/procurement\/[\w-]+$/);
  await expect(page.getByRole("heading", { name: "Line items" })).toBeVisible();
  await expect(visibleText(page, "OPC 53 Cement")).toBeVisible();
});

test("vendors directory lists suppliers with rollups", async ({ page }) => {
  await page.goto("/vendors");
  await expect(visibleText(page, "UltraTech Cement")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Lifetime purchases" })).toBeVisible();
});

test("project overview shows the real budget breakdown", async ({ page }) => {
  await page.goto("/projects/10000000-0000-0000-0000-000000000001");
  await expect(page.getByText("Labor cost")).toBeVisible();
  await expect(page.getByText("Procurement cost")).toBeVisible();
  await expect(page.getByText(/% utilized/)).toBeVisible();
});
