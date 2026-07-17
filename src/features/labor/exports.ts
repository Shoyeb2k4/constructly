"use client";

import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";
import { toRupees } from "@/lib/money";
import { estimateCostPaise } from "./calc";
import type { AttendanceRecordItem, AttendanceSheet, LabourSummary } from "./types";

// jsPDF's built-in fonts lack the ₹ glyph — use "Rs." in exports.
const rs = (paise: number) => `Rs. ${toRupees(paise).toLocaleString("en-IN")}`;

function pdfHeader(doc: jsPDF, title: string, subtitle: string) {
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Constructly", 14, 16);
  doc.setFontSize(12);
  doc.text(title, 14, 24);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(subtitle, 14, 30);
  doc.text(`Generated ${new Date().toLocaleString("en-IN")}`, 14, 35);
  doc.setTextColor(0);
}

/* ── Daily sheet (grouped by category) ───────────────────────────────── */

export function exportSheetPdf(sheet: AttendanceSheet, projectName: string) {
  const doc = new jsPDF();
  pdfHeader(doc, "Daily labour attendance", `${projectName} · ${sheet.date}`);
  const body: RowInput[] = [];
  for (const g of sheet.groups) {
    const rows = g.rows.filter((r) => r.quantity > 0);
    if (rows.length === 0) continue;
    body.push([{ content: g.name, colSpan: 5, styles: { fontStyle: "bold", fillColor: [244, 245, 247] } }]);
    rows.forEach((r) =>
      body.push([
        `  ${r.name}`,
        String(r.quantity),
        r.dailyRatePaise != null ? rs(r.dailyRatePaise) : "—",
        rs(estimateCostPaise(r.dailyRatePaise, r.quantity)),
        r.notes ?? "",
      ]),
    );
    body.push([
      { content: `${g.name} total`, styles: { fontStyle: "bold" } },
      { content: String(g.totalPresent), styles: { fontStyle: "bold" } },
      "",
      { content: rs(g.estimatedCostPaise), styles: { fontStyle: "bold" } },
      "",
    ]);
  }
  autoTable(doc, {
    startY: 42,
    head: [["Category / Subcategory", "Present", "Day rate", "Est. cost", "Notes"]],
    body,
    foot: [["Grand total", String(sheet.totalPresent), "", rs(sheet.estimatedCostPaise), ""]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [46, 91, 255] },
  });
  doc.save(`attendance-${projectName.replace(/\s+/g, "-").toLowerCase()}-${sheet.date}.pdf`);
}

export function exportSheetExcel(sheet: AttendanceSheet, projectName: string) {
  const rows: (string | number | null)[][] = [
    ["Constructly — Daily labour attendance"],
    [`${projectName} · ${sheet.date}`],
    [],
    ["Category", "Subcategory", "Present", "Day rate (Rs.)", "Est. cost (Rs.)", "Notes"],
  ];
  for (const g of sheet.groups) {
    const active = g.rows.filter((r) => r.quantity > 0);
    if (active.length === 0) continue;
    active.forEach((r) =>
      rows.push([
        g.name,
        r.name,
        r.quantity,
        r.dailyRatePaise != null ? toRupees(r.dailyRatePaise) : null,
        toRupees(estimateCostPaise(r.dailyRatePaise, r.quantity)),
        r.notes ?? "",
      ]),
    );
    rows.push([`${g.name} total`, "", g.totalPresent, null, toRupees(g.estimatedCostPaise), ""]);
  }
  rows.push([], ["Grand total", "", sheet.totalPresent, null, toRupees(sheet.estimatedCostPaise), ""]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Attendance");
  XLSX.writeFile(wb, `attendance-${projectName.replace(/\s+/g, "-").toLowerCase()}-${sheet.date}.xlsx`);
}

/* ── Range summary (hierarchical) ────────────────────────────────────── */

export interface RangeExportInput {
  records: AttendanceRecordItem[];
  summary: LabourSummary;
  from: string;
  to: string;
  scope: string;
}

export function exportRangePdf({ records, summary, from, to, scope }: RangeExportInput) {
  const doc = new jsPDF();
  pdfHeader(doc, "Labour summary", `${scope} · ${from} → ${to}`);
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
    startY: 42,
    head: [["Category / Subcategory", "Man-days", "Est. cost"]],
    body,
    foot: [["Grand total", String(summary.totalManDays), rs(summary.estimatedCostPaise)]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [46, 91, 255] },
  });
  autoTable(doc, {
    head: [["Date", "Project", "Category", "Subcategory", "Present", "Notes"]],
    body: records.map((r) => [r.date, r.projectName, r.categoryName, r.subcategoryName, String(r.quantityPresent), r.notes ?? ""]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [46, 91, 255] },
  });
  doc.save(`labour-summary-${from}-to-${to}.pdf`);
}

export function exportRangeExcel({ records, summary, from, to, scope }: RangeExportInput) {
  const summaryRows: (string | number | null)[][] = [
    ["Constructly — Labour summary"],
    [`${scope} · ${from} → ${to}`],
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
      ["Date", "Project", "Category", "Subcategory", "Present", "Notes"],
      ...records.map((r) => [r.date, r.projectName, r.categoryName, r.subcategoryName, r.quantityPresent, r.notes ?? ""]),
    ]),
    "Daily records",
  );
  XLSX.writeFile(wb, `labour-summary-${from}-to-${to}.xlsx`);
}
