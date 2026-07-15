import { test, expect } from "@playwright/test";

test("procurement lists purchase orders with an approval inbox", async ({ page }) => {
  await page.goto("/procurement");
  await expect(page.getByRole("heading", { name: "Procurement" })).toBeVisible();
  await expect(page.getByText("PO-0231")).toBeVisible();
  await expect(page.getByRole("button", { name: "New purchase order" })).toBeVisible();
});

test("opening a purchase order shows its line items", async ({ page }) => {
  await page.goto("/procurement");
  await page.getByText("PO-0231").click();
  await expect(page).toHaveURL(/\/procurement\/[\w-]+$/);
  await expect(page.getByText("Line items")).toBeVisible();
  await expect(page.getByText("OPC 53 Cement")).toBeVisible();
});

test("vendors directory lists suppliers with rollups", async ({ page }) => {
  await page.goto("/vendors");
  await expect(page.getByText("UltraTech Cement")).toBeVisible();
  await expect(page.getByText("Lifetime purchases").first()).toBeVisible();
});

test("project overview shows the real budget breakdown", async ({ page }) => {
  await page.goto("/projects/10000000-0000-0000-0000-000000000001");
  await expect(page.getByText("Labor cost")).toBeVisible();
  await expect(page.getByText("Procurement cost")).toBeVisible();
  await expect(page.getByText(/% utilized/)).toBeVisible();
});
