import { test, expect } from "@playwright/test";

test("reports hub lists the report catalogue with a flagship", async ({ page }) => {
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(page.getByText("Budget vs Actual")).toBeVisible();
  await expect(page.getByText("Flagship")).toBeVisible();
  await expect(page.getByText("Labour cost")).toBeVisible();
  await expect(page.getByText("Procurement report")).toBeVisible();
  await expect(page.getByText("Vendor report")).toBeVisible();
});

test("budget vs actual report renders KPIs, rows, and a total", async ({ page }) => {
  await page.goto("/reports/budget-vs-actual");
  await expect(page.getByRole("heading", { name: "Budget vs Actual" })).toBeVisible();
  await expect(page.getByText("Total budget")).toBeVisible();
  await expect(page.getByText("Skyline Residency")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Total" })).toBeVisible();
  // Column headers present.
  await expect(page.getByRole("columnheader", { name: "Procurement" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Utilization" })).toBeVisible();
});

test("labour cost report groups by category with a grand total", async ({ page }) => {
  await page.goto("/reports/labour-cost");
  await expect(page.getByText("Man-days")).toBeVisible();
  await expect(page.getByText("Grand total")).toBeVisible();
});

test("procurement report exposes export buttons and a project filter", async ({ page }) => {
  await page.goto("/reports/procurement");
  await expect(page.getByRole("button", { name: "Excel" })).toBeVisible();
  await expect(page.getByRole("button", { name: "PDF" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "GST" })).toBeVisible();
});
