"use client";

import * as XLSX from "xlsx";
import autoTable, { type RowInput, type CellDef } from "jspdf-autotable";
import { createBrandedPdf } from "@/features/branding/pdf";
import {
  buildCsv,
  buildExportRows,
  exportFileName,
  formatExportCell,
  groupLabel,
} from "./export-model";
import type { ReportColumn, ReportResult, ReportRow } from "./types";
import { saveGeneratedFile, saveWorkbook } from "@/lib/exports";

/**
 * Report exports — three formats, one grammar.
 *
 * WHAT an export contains is decided in `export-model.ts`, which is pure. This
 * module only writes it out, and is deliberately the only place that touches
 * jsPDF, SheetJS and the branded-PDF helper. That split matters: those bring in
 * the server stack (branding's PDF data comes from a server action, which pulls
 * in Prisma), so anything that merely needs an export's CONTENT must import the
 * model rather than this file.
 *
 * The scoping guarantee is structural rather than enforced here: every format
 * renders the same `ReportResult` the user is looking at, produced by the same
 * `run` under the same filters and the same permission gate. A file therefore
 * cannot contain a row its owner could not see on screen.
 */

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

  autoTable(doc, {
    startY: cursorY,
    head: [result.columns.map((c) => c.label)] as RowInput[],
    body: result.rows.map((r) => rowToPdf(r, result.columns)),
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

  finalize(`${exportFileName(result.title)}.pdf`);
}

function rowToPdf(row: ReportRow, columns: ReportColumn[]): RowInput {
  if (row.kind === "group") {
    return [{ content: groupLabel(row), colSpan: columns.length } as CellDef];
  }
  return row.cells.map((cell, i) => formatExportCell(cell, columns[i], true));
}

/* ── Excel ───────────────────────────────────────────────────────────── */

export async function reportToExcel(result: ReportResult, companyName = ""): Promise<void> {
  const ws = XLSX.utils.aoa_to_sheet(buildExportRows(result, companyName));
  ws["!cols"] = result.columns.map((c) => ({
    wch: c.kind === "money" ? 16 : Math.max(12, c.label.length + 2),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  // Not `XLSX.writeFile`: that clicks a hidden `<a download>`, which is inert
  // inside a Capacitor WebView. `saveWorkbook` keeps the browser behaviour and
  // routes the native build through the share sheet instead.
  await saveWorkbook(wb, `${exportFileName(result.title)}.xlsx`);
}

/* ── CSV ──────────────────────────────────────────────────────────────── */

export async function reportToCsv(result: ReportResult, companyName = ""): Promise<void> {
  // A UTF-8 BOM so Excel on Windows reads the file as UTF-8 rather than the
  // system codepage — without it, any non-ASCII name arrives mangled.
  const blob = new Blob(["﻿" + buildCsv(result, companyName)], {
    type: "text/csv;charset=utf-8;",
  });
  await saveGeneratedFile(blob, `${exportFileName(result.title)}.csv`);
}
