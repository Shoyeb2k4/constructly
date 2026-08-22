import { test, expect } from "@playwright/test";

/**
 * The behaviour these have always protected: the hub lists the catalogue, and a
 * report renders KPIs, rows and a folded total.
 *
 * Updated for the redesign rather than weakened. Two things moved: the
 * catalogue is now a grouped list whose entries lead with the QUESTION each
 * report answers, and a folded total is rendered as its own labelled strip
 * instead of a table row — a total spread across ten columns reads as nine
 * empty cells to a screen reader. Report names also settled on the source
 * modules' vocabulary ("Purchase orders", "Vendor summary").
 */

test("reports hub lists the report catalogue with a flagship", async ({ page }) => {
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(page.getByText("Budget vs Actual")).toBeVisible();
  await expect(page.getByText("Flagship").first()).toBeVisible();
  await expect(page.getByText("Labour cost")).toBeVisible();
  await expect(page.getByText("Purchase orders")).toBeVisible();
  await expect(page.getByText("Vendor summary")).toBeVisible();
});

test("budget vs actual report renders KPIs, rows, and a total", async ({ page }) => {
  await page.goto("/reports/budget-vs-actual");
  await expect(page.getByRole("heading", { name: "Budget vs Actual" })).toBeVisible();
  await expect(page.getByText("Total budget").first()).toBeVisible();
  await expect(page.getByRole("table").first().getByText("Skyline Residency")).toBeVisible();
  // The folded total, as its own strip rather than a ten-column row.
  await expect(page.getByText("Total", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Ordered value" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Utilisation" })).toBeVisible();
});

test("labour cost report groups by category with a grand total", async ({ page }) => {
  await page.goto("/reports/labour-cost?period=ALL_TIME");
  await expect(page.getByText("Man-days").first()).toBeVisible();
  await expect(page.getByText("Grand total")).toBeVisible();
});

test("procurement report exposes export buttons and a project filter", async ({ page }) => {
  await page.goto("/reports/procurement");
  await expect(page.getByRole("button", { name: "Excel" })).toBeVisible();
  await expect(page.getByRole("button", { name: "PDF" })).toBeVisible();
  // CSV joined the export grammar in the redesign.
  await expect(page.getByRole("button", { name: "CSV" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Project" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "GST" })).toBeVisible();
});
