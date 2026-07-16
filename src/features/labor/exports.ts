"use client";

import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
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

/* ── Daily sheet ─────────────────────────────────────────────────────── */

export function exportSheetPdf(sheet: AttendanceSheet, projectName: string) {
  const doc = new jsPDF();
  pdfHeader(doc, "Daily labour attendance", `${projectName} · ${sheet.date}`);
  autoTable(doc, {
    startY: 42,
    head: [["Category", "Present", "Day rate", "Est. cost", "Notes"]],
    body: sheet.rows
      .filter((r) => r.quantity > 0)
      .map((r) => [
        r.name,
        String(r.quantity),
        r.dailyRatePaise != null ? rs(r.dailyRatePaise) : "—",
        rs(estimateCostPaise(r.dailyRatePaise, r.quantity)),
        r.notes ?? "",
      ]),
    foot: [["Total", String(sheet.totalPresent), "", rs(sheet.estimatedCostPaise), ""]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [46, 91, 255] },
  });
  doc.save(`attendance-${projectName.replace(/\s+/g, "-").toLowerCase()}-${sheet.date}.pdf`);
}

export function exportSheetExcel(sheet: AttendanceSheet, projectName: string) {
  const rows = [
    ["Constructly — Daily labour attendance"],
    [`${projectName} · ${sheet.date}`],
    [],
    ["Category", "Present", "Day rate (Rs.)", "Est. cost (Rs.)", "Notes"],
    ...sheet.rows
      .filter((r) => r.quantity > 0)
      .map((r) => [
        r.name,
        r.quantity,
        r.dailyRatePaise != null ? toRupees(r.dailyRatePaise) : null,
        toRupees(estimateCostPaise(r.dailyRatePaise, r.quantity)),
        r.notes ?? "",
      ]),
    [],
    ["Total", sheet.totalPresent, "", toRupees(sheet.estimatedCostPaise), ""],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Attendance");
  XLSX.writeFile(wb, `attendance-${projectName.replace(/\s+/g, "-").toLowerCase()}-${sheet.date}.xlsx`);
}

/* ── Range summary ───────────────────────────────────────────────────── */

export interface RangeExportInput {
  records: AttendanceRecordItem[];
  summary: LabourSummary;
  from: string;
  to: string;
  scope: string; // "All projects" or a project name
}

export function exportRangePdf({ records, summary, from, to, scope }: RangeExportInput) {
  const doc = new jsPDF();
  pdfHeader(doc, "Labour summary", `${scope} · ${from} → ${to}`);
  autoTable(doc, {
    startY: 42,
    head: [["Category", "Man-days", "Est. cost"]],
    body: summary.byCategory.map((c) => [c.name, String(c.manDays), rs(c.estimatedCostPaise)]),
    foot: [["Total", String(summary.totalManDays), rs(summary.estimatedCostPaise)]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [46, 91, 255] },
  });
  autoTable(doc, {
    head: [["Date", "Project", "Category", "Present", "Notes"]],
    body: records.map((r) => [r.date, r.projectName, r.categoryName, String(r.quantityPresent), r.notes ?? ""]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [46, 91, 255] },
  });
  doc.save(`labour-summary-${from}-to-${to}.pdf`);
}

export function exportRangeExcel({ records, summary, from, to, scope }: RangeExportInput) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Constructly — Labour summary"],
      [`${scope} · ${from} → ${to}`],
      [],
      ["Category", "Man-days", "Est. cost (Rs.)"],
      ...summary.byCategory.map((c) => [c.name, c.manDays, toRupees(c.estimatedCostPaise)]),
      [],
      ["Total", summary.totalManDays, toRupees(summary.estimatedCostPaise)],
    ]),
    "Summary",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Date", "Project", "Category", "Present", "Notes"],
      ...records.map((r) => [r.date, r.projectName, r.categoryName, r.quantityPresent, r.notes ?? ""]),
    ]),
    "Daily records",
  );
  XLSX.writeFile(wb, `labour-summary-${from}-to-${to}.xlsx`);
}
