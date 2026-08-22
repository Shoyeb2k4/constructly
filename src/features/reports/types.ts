/**
 * Reports domain.
 *
 * The one rule this module exists to enforce: **Reports consumes canonical
 * calculations; it never owns them.** A report is a registry entry whose `run`
 * calls the SAME repositories and aggregation the operational modules use —
 * `summarisePayments` for cash, the agreement reconciliation engine for a
 * contractor's position, the shared budget source for spend, the stored
 * attendance snapshot for labour value. A second calculation path here is the
 * failure mode, because a report that quietly disagrees with the screen it
 * summarises is worse than no report at all.
 *
 * A report therefore returns a generic, presentation-only `ReportResult`. It
 * carries no formulas — only rows, totals someone else computed, and enough
 * context (period, filters, company) that the export is self-describing.
 */

import type { Permission } from "@/features/rbac/permissions";
import type { Period, PeriodPreset } from "@/lib/period";

export type { Period, PeriodPreset };

export type ColumnKind = "text" | "money" | "number" | "date";

export interface ReportColumn {
  key: string;
  label: string;
  kind?: ColumnKind; // default "text"
  align?: "left" | "right"; // default: right for money/number
  /** Drop on narrow viewports rather than letting the column squeeze. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
}

/** A row's cells align positionally to `columns`. Money cells are integer paise. */
export interface ReportRow {
  cells: (string | number | null)[];
  /** "group" = section header, "total" = bold summary line, else data. */
  kind?: "data" | "group" | "total";
  /** Optional deep-link into the CANONICAL record — never a Reports-only page. */
  href?: string;
}

/**
 * A headline figure. `value` is pre-formatted by the report, because only the
 * report knows whether its number is money, a count or a percentage — but every
 * report states its period in `ReportResult.periodLabel` rather than in here.
 */
export interface ReportKpi {
  label: string;
  /** Display text for non-money figures (counts, percentages). */
  value: string;
  /**
   * Integer paise when the figure is MONEY.
   *
   * Carried instead of a pre-formatted string so the shell can render it with
   * `MoneyText`, which shows the full Indian amount and never rounds. Reports
   * previously used the compact form here — "₹1.2Cr" beside a table whose total
   * read ₹1,21,16,000 — which is the one thing the project's money standard
   * exists to prevent.
   */
  paise?: number;
  /** One line of what the figure means, in the source module's words. */
  hint?: string;
}

/**
 * A chart is added ONLY where shape over time or proportion answers the
 * question better than the rows do. It is a re-presentation of data already in
 * the table — never the only place a number appears — and carries a text
 * alternative so it is not the only way to read it.
 */
export interface ReportChart {
  title: string;
  /** What the chart says, in words, for anyone not reading the bars. */
  description: string;
  /** Money is rendered in paise; number is a plain count (e.g. man-days). */
  kind: "money" | "number";
  points: { label: string; value: number }[];
}

/** One active filter, echoed on screen and into every export. */
export interface ReportFilterEcho {
  label: string;
  value: string;
}

export interface ReportResult {
  id: string;
  title: string;
  subtitle: string;
  generatedAt: string; // ISO
  /** The period every figure below covers. Never blank. */
  periodLabel: string;
  /** The filters that produced these rows — shown on screen and exported. */
  activeFilters: ReportFilterEcho[];
  kpis: ReportKpi[];
  columns: ReportColumn[];
  rows: ReportRow[];
  chart?: ReportChart;
  /** An honest limitation of the underlying data, where one applies. */
  note?: string;
  /** True when the query returned nothing for THIS period/filter set. */
  isEmpty: boolean;
  /**
   * False only when the company has no such records AT ALL.
   *
   * Distinct from `isEmpty` on purpose: "no payments in August" and "this
   * company has never recorded a payment" need different words, and conflating
   * them tells an established business it has no history.
   */
  hasAnyData: boolean;
}

export type ReportCategory =
  | "Projects"
  | "Labour"
  | "Contractors"
  | "Procurement"
  | "Payments";

/** Which filter controls a report accepts. Each report declares only its own. */
export type ReportFilterKey =
  | "period"
  | "project"
  | "vendor"
  | "contractor"
  | "transactionType"
  | "status";

export interface ReportFilters {
  /** The preset the user chose. Resolved to `dateFrom`/`dateTo` before `run`. */
  period?: PeriodPreset;
  /** Inclusive bounds. Always concrete by the time a report runs. */
  dateFrom?: string;
  dateTo?: string;
  projectId?: string; // "" or undefined = all
  vendorId?: string;
  contractorId?: string;
  transactionType?: string;
  status?: string;
}

/** Everything `run` needs that is not a user filter. */
export interface ReportContext {
  /** Resolved from the preset (or the raw bounds) — labels every figure. */
  period: Period;
  /** YYYY-MM-DD, pinned so server and client agree on what "today" is. */
  today: string;
  userId: string;
  isOwner: boolean;
  /**
   * The caller's resolved permissions.
   *
   * Carried so a report can ask its SOURCE module what this caller may see —
   * `paymentsVisibilityFor(...)`, for instance — rather than Reports inventing
   * a second visibility rule. A report must never widen what its source module
   * would have shown.
   */
  permissions: Permission[];
}

export interface ReportDef {
  id: string;
  name: string;
  /** The QUESTION this report answers, in one line, in the user's words. */
  question: string;
  category: ReportCategory;
  filters: ReportFilterKey[];
  /** Default period when the URL names none. */
  defaultPeriod?: PeriodPreset;
  /** Flagship reports surface first. */
  featured?: boolean;
  run: (filters: ReportFilters, ctx: ReportContext) => Promise<ReportResult>;
}
