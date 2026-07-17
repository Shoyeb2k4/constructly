/** Reports domain. A report is a generic tabular `ReportResult` produced by a
 *  registry entry's `run()` — which calls the SAME shared repositories /
 *  aggregation the Dashboard, Project Overview, Procurement, and Labour modules
 *  use, so every report matches those views exactly (single source of truth). */

export type ColumnKind = "text" | "money" | "number" | "date";

export interface ReportColumn {
  key: string;
  label: string;
  kind?: ColumnKind; // default "text"
  align?: "left" | "right"; // default: right for money/number
}

/** A row's cells align positionally to `columns`. Money cells are integer paise. */
export interface ReportRow {
  cells: (string | number | null)[];
  /** "group" = section header, "total" = bold summary line, else data. */
  kind?: "data" | "group" | "total";
  /** Optional deep-link applied to the row in the on-screen table. */
  href?: string;
}

export interface ReportKpi {
  label: string;
  /** Pre-formatted display string (e.g. "₹1.2Cr", "128"). */
  value: string;
}

export interface ReportResult {
  id: string;
  title: string;
  subtitle: string;
  generatedAt: string; // ISO
  kpis: ReportKpi[];
  columns: ReportColumn[];
  rows: ReportRow[];
  /** True when the underlying query returned nothing in scope. */
  isEmpty: boolean;
}

export type ReportCategory = "Project" | "Labour" | "Procurement" | "Vendor" | "Financial";

/** Which filter controls a report accepts. */
export type ReportFilterKey = "dateRange" | "project" | "vendor";

export interface ReportFilters {
  projectId?: string; // "" or undefined = all
  vendorId?: string;
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string;
}

export interface ReportDef {
  id: string;
  name: string;
  description: string;
  category: ReportCategory;
  filters: ReportFilterKey[];
  /** Flagship reports surface first. */
  featured?: boolean;
  run: (filters: ReportFilters) => Promise<ReportResult>;
}
