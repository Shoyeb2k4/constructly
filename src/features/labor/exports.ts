"use client";

import * as XLSX from "xlsx";
import autoTable, { type RowInput } from "jspdf-autotable";
import { toRupees } from "@/lib/money";
import { createBrandedPdf } from "@/features/branding/pdf";
import { estimateCostPaise } from "./calc";
import type { AttendanceRecordItem, AttendanceSheet, LabourSummary } from "./types";
import { saveWorkbook } from "@/lib/exports";

// jsPDF's built-in fonts lack the ₹ glyph — use "Rs." in exports.
const rs = (paise: number) => `Rs. ${toRupees(paise).toLocaleString("en-IN")}`;

/* ── Daily sheet (grouped by contractor) ─────────────────────────────── */

export async function exportSheetPdf(sheet: AttendanceSheet, projectName: string) {
  const { doc, startY, finalize } = await createBrandedPdf({
    title: "Daily labour attendance",
    subtitle: `${projectName} · ${sheet.date}`,
  });
  const body: RowInput[] = [];
  for (const g of sheet.groups) {
    const rows = g.rows.filter((r) => r.quantity > 0);
    if (rows.length === 0) continue;
    body.push([{ content: g.contractorName, colSpan: 5, styles: { fontStyle: "bold", fillColor: [244, 245, 247] } }]);
    rows.forEach((r) =>
      body.push([
        r.agreementTitle ? `  ${r.name} (${r.agreementTitle})` : `  ${r.name}`,
        String(r.quantity),
        r.dailyRatePaise != null ? rs(r.dailyRatePaise) : "—",
        rs(estimateCostPaise(r.dailyRatePaise, r.quantity)),
        r.notes ?? "",
      ]),
    );
    body.push([
      { content: `${g.contractorName} total`, styles: { fontStyle: "bold" } },
      { content: String(g.totalPresent), styles: { fontStyle: "bold" } },
      "",
      { content: rs(g.estimatedCostPaise), styles: { fontStyle: "bold" } },
      "",
    ]);
  }
  autoTable(doc, {
    startY,
    head: [["Contractor / Labour type", "Present", "Day rate", "Est. cost", "Notes"]],
    body,
    foot: [["Grand total", String(sheet.totalPresent), "", rs(sheet.estimatedCostPaise), ""]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [46, 91, 255] },
  });
  finalize(`attendance-${projectName.replace(/\s+/g, "-").toLowerCase()}-${sheet.date}.pdf`);
}

export async function exportSheetExcel(sheet: AttendanceSheet, projectName: string) {
  const rows: (string | number | null)[][] = [
    ["Constructly — Daily labour attendance"],
    [`${projectName} · ${sheet.date}`],
    [],
    ["Contractor", "Agreement", "Labour type", "Category", "Present", "Day rate (Rs.)", "Est. cost (Rs.)", "Notes"],
  ];
  for (const g of sheet.groups) {
    const active = g.rows.filter((r) => r.quantity > 0);
    if (active.length === 0) continue;
    active.forEach((r) =>
      rows.push([
        g.contractorName,
        r.agreementTitle ?? "—",
        r.name,
        r.categoryName,
        r.quantity,
        r.dailyRatePaise != null ? toRupees(r.dailyRatePaise) : null,
        toRupees(estimateCostPaise(r.dailyRatePaise, r.quantity)),
        r.notes ?? "",
      ]),
    );
    rows.push([`${g.contractorName} total`, "", "", "", g.totalPresent, null, toRupees(g.estimatedCostPaise), ""]);
  }
  rows.push([], ["Grand total", "", "", "", sheet.totalPresent, null, toRupees(sheet.estimatedCostPaise), ""]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Attendance");
  await saveWorkbook(wb, `attendance-${projectName.replace(/\s+/g, "-").toLowerCase()}-${sheet.date}.xlsx`);
}

/* ── Range summary (hierarchical) ────────────────────────────────────── */

export interface RangeExportInput {
  records: AttendanceRecordItem[];
  summary: LabourSummary;
  from: string;
  to: string;
  scope: string;
}

export async function exportRangePdf({ records, summary, from, to, scope }: RangeExportInput) {
  const { doc, startY, finalize } = await createBrandedPdf({
    title: "Labour summary",
    subtitle: `${scope} · ${from} → ${to}`,
  });
  // By contractor (the primary contractor-first rollup).
  autoTable(doc, {
    startY,
    head: [["Contractor", "Man-days", "Est. cost"]],
    body: summary.byContractor.map((c) => [c.name, String(c.manDays), rs(c.estimatedCostPaise)]),
    foot: [["Grand total", String(summary.totalManDays), rs(summary.estimatedCostPaise)]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [46, 91, 255] },
  });
  const body: RowInput[] = [];
  for (const c of summary.byCategory) {
    body.push([{ content: c.name, colSpan: 3, styles: { fontStyle: "bold", fillColor: [244, 245, 247] } }]);
    c.subcategories.forEach((s) => body.push([`  ${s.name}`, String(s.manDays), rs(s.estimatedCostPaise)]));
    body.push([
      { content: `${c.name} total`, styles: { fontStyle: "bold" } },
      { content: String(c.manDays), styles: { fontStyle: "bold" } },
      { content: rs(c.estimatedCostPaise), styles: { fontStyle: "bold" } },
    ]);
  }
  autoTable(doc, {
    head: [["Category / Subcategory", "Man-days", "Est. cost"]],
    body,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [46, 91, 255] },
  });
  autoTable(doc, {
    head: [["Date", "Project", "Contractor", "Agreement", "Category", "Labour type", "Present", "Notes"]],
    body: records.map((r) => [
      r.date,
      r.projectName,
      r.contractorName ?? "—",
      r.agreementTitle ?? "—",
      r.categoryName,
      r.subcategoryName,
      String(r.quantityPresent),
      r.notes ?? "",
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [46, 91, 255] },
  });
  finalize(`labour-summary-${from}-to-${to}.pdf`);
}

export async function exportRangeExcel({ records, summary, from, to, scope }: RangeExportInput) {
  const summaryRows: (string | number | null)[][] = [
    ["Constructly — Labour summary"],
    [`${scope} · ${from} → ${to}`],
    [],
    ["By contractor", "Man-days", "Est. cost (Rs.)"],
    ...summary.byContractor.map((c) => [c.name, c.manDays, toRupees(c.estimatedCostPaise)]),
    [],
    ["Category", "Subcategory", "Man-days", "Est. cost (Rs.)"],
  ];
  for (const c of summary.byCategory) {
    c.subcategories.forEach((s) => summaryRows.push([c.name, s.name, s.manDays, toRupees(s.estimatedCostPaise)]));
    summaryRows.push([`${c.name} total`, "", c.manDays, toRupees(c.estimatedCostPaise)]);
  }
  summaryRows.push([], ["Grand total", "", summary.totalManDays, toRupees(summary.estimatedCostPaise)]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Summary");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Date", "Project", "Contractor", "Agreement", "Category", "Labour type", "Present", "Notes"],
      ...records.map((r) => [
        r.date,
        r.projectName,
        r.contractorName ?? "—",
        r.agreementTitle ?? "—",
        r.categoryName,
        r.subcategoryName,
        r.quantityPresent,
        r.notes ?? "",
      ]),
    ]),
    "Daily records",
  );
  await saveWorkbook(wb, `labour-summary-${from}-to-${to}.xlsx`);
}
