import { formatPaiseCompact } from "@/lib/money";
import type { ReportFilterEcho, ReportFilters, ReportKpi } from "../types";

/**
 * Helpers shared by the report definitions.
 *
 * Deliberately contains NO financial arithmetic. Everything here is labelling
 * and shaping; the numbers arrive already computed by the module that owns
 * them, and this file must never become the place a formula quietly appears.
 */

export const now = () => new Date().toISOString();

/** Money KPI, formatted compactly for a headline tile. */
export function moneyKpi(label: string, paise: number, hint?: string): ReportKpi {
  return { label, value: formatPaiseCompact(paise), hint };
}

export function countKpi(label: string, n: number, hint?: string): ReportKpi {
  return { label, value: String(n), hint };
}

/**
 * The filters that produced a result, in words — shown on screen and written
 * into every export, so a spreadsheet that leaves the building still says what
 * it is a report OF.
 */
export function echoFilters(
  f: ReportFilters,
  names: {
    project?: Map<string, string>;
    vendor?: Map<string, string>;
    contractor?: Map<string, string>;
    transactionType?: Map<string, string>;
    status?: Map<string, string>;
  } = {},
): ReportFilterEcho[] {
  const out: ReportFilterEcho[] = [];
  const add = (label: string, id: string | undefined, map?: Map<string, string>) => {
    if (!id) return;
    out.push({ label, value: map?.get(id) ?? id });
  };
  add("Project", f.projectId, names.project);
  add("Vendor", f.vendorId, names.vendor);
  add("Contractor", f.contractorId, names.contractor);
  add("Type", f.transactionType, names.transactionType);
  add("Status", f.status, names.status);
  return out;
}

/** `n` of a thing, pluralised without a bare "(s)". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Bucket dated money into calendar months for a trend chart.
 *
 * Presentation only: it re-groups amounts that a canonical summariser has
 * already decided are countable, and never changes what any of them mean.
 */
export function monthlyPoints(
  rows: { date: string; amountPaise: number }[],
): { label: string; value: number }[] {
  const by = new Map<string, number>();
  for (const r of rows) {
    const key = r.date.slice(0, 7);
    by.set(key, (by.get(key) ?? 0) + r.amountPaise);
  }
  return [...by.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => ({ label: key, value }));
}
