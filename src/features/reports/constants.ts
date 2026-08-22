import type { PeriodPreset } from "@/lib/period";

/**
 * The periods Reports offers.
 *
 * A superset of the Payments Centre's menu — an operational page has no use for
 * "Today", an analysis surface does — but resolved by the SAME function, so
 * "this month" cannot mean two different ranges in two places.
 */
export const REPORT_PERIODS: { value: PeriodPreset; label: string }[] = [
  { value: "TODAY", label: "Today" },
  { value: "THIS_WEEK", label: "This week" },
  { value: "THIS_MONTH", label: "This month" },
  { value: "LAST_MONTH", label: "Last month" },
  { value: "LAST_90", label: "Last 90 days" },
  { value: "FINANCIAL_YEAR", label: "Financial year" },
  { value: "ALL_TIME", label: "All time" },
  { value: "CUSTOM", label: "Custom range" },
];

/** The status vocabulary a report filter offers, in the Payments module's words. */
export const REPORT_STATUSES = [
  { value: "ALL", label: "Active and reversed" },
  { value: "ACTIVE", label: "Active only" },
  { value: "REVERSED", label: "Reversed only" },
];
