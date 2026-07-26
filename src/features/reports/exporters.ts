"use client";

import * as XLSX from "xlsx";
import autoTable, { type RowInput, type CellDef } from "jspdf-autotable";
import { toRupees } from "@/lib/money";
import { createBrandedPdf } from "@/features/branding/pdf";
import type { ReportColumn, ReportResult, ReportRow } from "./types";

// jsPDF's built-in fonts lack the ₹ glyph — use "Rs." in exports.
const rs = (paise: number) => `Rs. ${toRupees(paise).toLocaleString("en-IN")}`;

/** Format a single cell for display/export by its column kind. */
function fmtCell(value: string | number | null, col: ReportColumn, forPdf: boolean): string {
  if (value == null || value === "") return "";
  if (col.kind === "money") return forPdf ? rs(Number(value)) : `₹${toRupees(Number(value)).toLocaleString("en-IN")}`;
  if (col.kind === "number") return String(value);
  return String(value);
}

/** Raw numeric value for Excel money/number cells (so totals/sorting work). */
function excelValue(value: string | number | null, col: ReportColumn): string | number {
  if (value == null || value === "") return "";
  if (col.kind === "money") return toRupees(Number(value));
  if (col.kind === "number") return Number(value);
  return String(value);
}

function safeName(title: string): string {
  return title.replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

/* ── PDF ─────────────────────────────────────────────────────────────── */

export async function reportToPdf(result: ReportResult): Promise<void> {
  const landscape = result.columns.length > 5;
  const { doc, startY, finalize } = await createBrandedPdf({
    title: result.title,
    subtitle: result.subtitle,
    orientation: landscape ? "landscape" : "portrait",
  });

  // KPI strip.
  let cursorY = startY;
  if (result.kpis.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
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
    columnStyles: Object.fromEntries(
      result.columns.map((c, i) => [i, { halign: c.align ?? (c.kind === "money" || c.kind === "number" ? "right" : "left") }]),
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

  finalize(`${safeName(result.title)}.pdf`);
}

function rowToPdf(row: ReportRow, columns: ReportColumn[]): RowInput {
  if (row.kind === "group") {
    // Group header spans all columns.
    const first = row.cells.find((c) => c != null && c !== "");
    return [{ content: String(first ?? ""), colSpan: columns.length } as CellDef];
  }
  return row.cells.map((cell, i) => fmtCell(cell, columns[i], true));
}

/* ── Excel ───────────────────────────────────────────────────────────── */

export function reportToExcel(result: ReportResult): void {
  const aoa: (string | number)[][] = [];
  aoa.push([result.title]);
  aoa.push([result.subtitle]);
  aoa.push([`Generated ${new Date(result.generatedAt).toLocaleString("en-IN")}`]);
  if (result.kpis.length) aoa.push(result.kpis.map((k) => `${k.label}: ${k.value}`));
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

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = result.columns.map((c) => ({ wch: c.kind === "money" ? 16 : Math.max(12, c.label.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, `${safeName(result.title)}.xlsx`);
}
