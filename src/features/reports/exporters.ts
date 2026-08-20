"use client";

import * as XLSX from "xlsx";
import autoTable, { type RowInput, type CellDef } from "jspdf-autotable";
import { toRupees } from "@/lib/money";
import { createBrandedPdf } from "@/features/branding/pdf";
import type { ReportColumn, ReportResult, ReportRow } from "./types";

/**
 * Report exports.
 *
 * One grammar across all three formats, and one rule behind it: **an export is
 * the report, not a subset of it and not a superset.** It carries exactly the
 * rows the user is looking at, produced by the same `run` under the same
 * filters and the same permission gate — so a file can never contain a row its
 * owner could not see on screen.
 *
 * The other rule is that a file must describe itself. A spreadsheet found in
 * someone's downloads six months later has no toolbar to explain it, so every
 * export carries the company, the report, the period, the active filters and
 * when it was generated. Without those it is a grid of numbers about nothing.
 */

// jsPDF's built-in fonts lack the ₹ glyph — use "Rs." in PDFs only.
const rs = (paise: number) => `Rs. ${toRupees(paise).toLocaleString("en-IN")}`;

/** Format one cell for display by its column kind. */
function fmtCell(value: string | number | null, col: ReportColumn, forPdf: boolean): string {
  if (value == null || value === "") return "";
  if (col.kind === "money")
    return forPdf ? rs(Number(value)) : `₹${toRupees(Number(value)).toLocaleString("en-IN")}`;
  if (col.kind === "number") return String(value);
  return String(value);
}

/**
 * Raw numeric value for spreadsheet money/number cells.
 *
 * Rupees as a NUMBER, not a formatted string — otherwise the first thing anyone
 * does with the file (sum a column, sort by amount) silently fails.
 */
function excelValue(value: string | number | null, col: ReportColumn): string | number {
  if (value == null || value === "") return "";
  if (col.kind === "money") return toRupees(Number(value));
  if (col.kind === "number") return Number(value);
  return String(value);
}

function safeName(title: string): string {
  return title.replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

/** The self-describing preamble every export shares. */
function preamble(result: ReportResult, companyName: string): string[][] {
  const lines: string[][] = [];
  if (companyName) lines.push([companyName]);
  lines.push([result.title]);
  lines.push(["Period", result.periodLabel]);
  if (result.activeFilters.length) {
    for (const f of result.activeFilters) lines.push([f.label, f.value]);
  } else {
    lines.push(["Filters", "None"]);
  }
  lines.push(["Generated", new Date(result.generatedAt).toLocaleString("en-IN")]);
  if (result.kpis.length) {
    lines.push([]);
    lines.push(result.kpis.map((k) => `${k.label}: ${k.value}`));
  }
  return lines;
}

/* ── PDF ─────────────────────────────────────────────────────────────── */

export async function reportToPdf(result: ReportResult): Promise<void> {
  const landscape = result.columns.length > 5;
  const { doc, startY, finalize } = await createBrandedPdf({
    title: result.title,
    subtitle: result.subtitle,
    orientation: landscape ? "landscape" : "portrait",
  });

  let cursorY = startY;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  // Period first, on its own line: it is the single most important thing about
  // a printed financial page, and the easiest to lose.
  doc.text(`Period: ${result.periodLabel}`, 14, cursorY);
  cursorY += 5;

  if (result.activeFilters.length) {
    doc.text(
      `Filters: ${result.activeFilters.map((f) => `${f.label} = ${f.value}`).join("   ")}`,
      14,
      cursorY,
    );
    cursorY += 5;
  }

  if (result.kpis.length) {
    const line = result.kpis.map((k) => `${k.label}: ${k.value.replace(/₹/g, "Rs.")}`).join("    ");
    doc.text(line, 14, cursorY);
    cursorY += 6;
  }

  const head: RowInput[] = [result.columns.map((c) => c.label)];
  const body: RowInput[] = result.rows.map((r) => rowToPdf(r, result.columns));

  autoTable(doc, {
    startY: cursorY,
    head,
    body,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255 },
    // Repeat the header on every page — a table whose columns are only named on
    // page one is unreadable from page two.
    showHead: "everyPage",
    columnStyles: Object.fromEntries(
      result.columns.map((c, i) => [
        i,
        { halign: c.align ?? (c.kind === "money" || c.kind === "number" ? "right" : "left") },
      ]),
    ),
    didParseCell: (data) => {
      const row = result.rows[data.row.index];
      if (!row || data.section !== "body") return;
      if (row.kind === "group") {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [244, 245, 247];
      } else if (row.kind === "total") {
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  if (result.note) {
    const after = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
    const y = (after?.finalY ?? cursorY) + 8;
    doc.setFontSize(7.5);
    doc.setTextColor(110);
    doc.text(doc.splitTextToSize(result.note, doc.internal.pageSize.getWidth() - 28), 14, y);
    doc.setTextColor(0);
  }

  finalize(`${safeName(result.title)}.pdf`);
}

function rowToPdf(row: ReportRow, columns: ReportColumn[]): RowInput {
  if (row.kind === "group") {
    const first = row.cells.find((c) => c != null && c !== "");
    return [{ content: String(first ?? ""), colSpan: columns.length } as CellDef];
  }
  return row.cells.map((cell, i) => fmtCell(cell, columns[i], true));
}

/* ── Excel ───────────────────────────────────────────────────────────── */

export function reportToExcel(result: ReportResult, companyName = ""): void {
  const aoa: (string | number)[][] = [...preamble(result, companyName)];
  aoa.push([]);
  aoa.push(result.columns.map((c) => c.label));

  for (const row of result.rows) {
    if (row.kind === "group") {
      const first = row.cells.find((c) => c != null && c !== "");
      aoa.push([String(first ?? "")]);
    } else {
      aoa.push(result.columns.map((c, i) => excelValue(row.cells[i], c)));
    }
  }

  if (result.note) {
    aoa.push([]);
    aoa.push([result.note]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = result.columns.map((c) => ({
    wch: c.kind === "money" ? 16 : Math.max(12, c.label.length + 2),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, `${safeName(result.title)}.xlsx`);
}

/* ── CSV ─────────────────────────────────────────────────────────────── */

/** RFC-4180 quoting: quote anything containing a comma, quote or newline. */
function csvCell(value: string | number): string {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportToCsv(result: ReportResult, companyName = ""): void {
  const lines: string[] = [];
  for (const row of preamble(result, companyName)) lines.push(row.map(csvCell).join(","));
  lines.push("");
  lines.push(result.columns.map((c) => csvCell(c.label)).join(","));

  for (const row of result.rows) {
    if (row.kind === "group") {
      const first = row.cells.find((c) => c != null && c !== "");
      lines.push(csvCell(String(first ?? "")));
    } else {
      // Numeric cells stay numeric for the same reason as the spreadsheet: a
      // CSV is opened in a spreadsheet, and "₹20,00,000" sorts as text.
      lines.push(result.columns.map((c, i) => csvCell(excelValue(row.cells[i], c))).join(","));
    }
  }
  if (result.note) {
    lines.push("");
    lines.push(csvCell(result.note));
  }

  // A UTF-8 BOM so Excel on Windows reads the file as UTF-8 rather than the
  // system codepage — without it, any non-ASCII name arrives mangled.
  const blob = new Blob(["﻿" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName(result.title)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
