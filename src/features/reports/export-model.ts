import { toRupees } from "@/lib/money";
import type { ReportColumn, ReportResult, ReportRow } from "./types";

/**
 * What an export CONTAINS, independent of how it is written out.
 *
 * Kept apart from `exporters.ts` on purpose. That module reaches for jsPDF,
 * SheetJS and the branded-PDF helper — and the branded-PDF helper pulls in
 * branding's server actions, which pull in Prisma. Importing any of that just
 * to ask "what rows would this export have?" drags the entire server stack into
 * a browser module graph; in a unit test it went further and silently flipped
 * the process out of demo mode, because Prisma loads `.env` on import.
 *
 * So the answer to that question lives here, where it depends on nothing but
 * the report and the money helpers. `exporters.ts` formats it; this decides it.
 *
 * The rule it encodes: an export is the report — not a subset, not a superset —
 * and it must describe itself, because a file found in someone's downloads six
 * months later has no toolbar next to it to explain what it is a report OF.
 */

/** RFC-4180 line ending — spreadsheets on Windows expect CRLF. */
export const CRLF = String.fromCharCode(13, 10);

/**
 * Raw numeric value for spreadsheet money/number cells.
 *
 * Rupees as a NUMBER, not a formatted string — otherwise the first thing anyone
 * does with the file (sum a column, sort by amount) silently fails.
 */
export function exportValue(
  value: string | number | null,
  col: ReportColumn,
): string | number {
  if (value == null || value === "") return "";
  if (col.kind === "money") return toRupees(Number(value));
  if (col.kind === "number") return Number(value);
  return String(value);
}

/** The self-describing preamble every export shares. */
export function preamble(result: ReportResult, companyName: string): string[][] {
  const lines: string[][] = [];
  if (companyName) lines.push([companyName]);
  lines.push([result.title]);
  lines.push(["Period", result.periodLabel]);
  if (result.activeFilters.length) {
    for (const f of result.activeFilters) lines.push([f.label, f.value]);
  } else {
    // Stated rather than omitted: an absent line reads as a filtered file.
    lines.push(["Filters", "None"]);
  }
  lines.push(["Generated", new Date(result.generatedAt).toLocaleString("en-IN")]);
  if (result.kpis.length) {
    lines.push([]);
    lines.push(result.kpis.map((k) => `${k.label}: ${k.value}`));
  }
  return lines;
}

/**
 * The rows an export contains, as a plain grid — one definition shared by both
 * spreadsheet formats, so CSV and Excel can never drift apart.
 */
export function buildExportRows(
  result: ReportResult,
  companyName = "",
): (string | number)[][] {
  const aoa: (string | number)[][] = [...preamble(result, companyName)];
  aoa.push([]);
  aoa.push(result.columns.map((c) => c.label));

  for (const row of result.rows) {
    if (row.kind === "group") {
      const first = row.cells.find((c) => c != null && c !== "");
      aoa.push([String(first ?? "")]);
    } else {
      aoa.push(result.columns.map((c, i) => exportValue(row.cells[i], c)));
    }
  }

  if (result.note) {
    aoa.push([]);
    aoa.push([result.note]);
  }
  return aoa;
}

/** RFC-4180 quoting: quote anything containing a comma, quote or newline. */
export function csvCell(value: string | number): string {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The exact text a CSV download contains. Pure, so it can be asserted. */
export function buildCsv(result: ReportResult, companyName = ""): string {
  return buildExportRows(result, companyName)
    .map((row) => row.map(csvCell).join(","))
    .join(CRLF);
}

/** Display formatting for a cell, by column kind. `forPdf` avoids the ₹ glyph. */
export function formatExportCell(
  value: string | number | null,
  col: ReportColumn,
  forPdf: boolean,
): string {
  if (value == null || value === "") return "";
  if (col.kind === "money") {
    const rupees = toRupees(Number(value)).toLocaleString("en-IN");
    // jsPDF's built-in fonts lack the ₹ glyph — use "Rs." in PDFs only.
    return forPdf ? `Rs. ${rupees}` : `₹${rupees}`;
  }
  if (col.kind === "number") return String(value);
  return String(value);
}

/** A group row collapses to its single label. */
export function groupLabel(row: ReportRow): string {
  return String(row.cells.find((c) => c != null && c !== "") ?? "");
}

export function exportFileName(title: string): string {
  return title.replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}
