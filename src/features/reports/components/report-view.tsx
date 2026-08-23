"use client";

/**
 * The report shell — one layout every report renders into.
 *
 * Before this, each report inherited a hand-built page: a filter Card that was
 * not the Toolbar, KPI tiles that were not StatCards, a `Skeleton h-80` that
 * matched nothing that followed it, and one empty state that told an
 * established company it had "nothing to report" because the month happened to
 * be quiet. Standardising the shell is what lets a new report be a registry
 * entry rather than a new page.
 *
 * The shell owns presentation and nothing else. Every figure it renders was
 * folded by the module that owns the arithmetic; this file adds no rupees
 * together.
 */

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  BarChart3,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Inbox,
  Info,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useCan } from "@/features/rbac/permission-context";
import { authorizeReportExport } from "../server/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatCard } from "@/components/patterns/stat-card";
import { Callout } from "@/components/patterns/callout";
import { BarSeries } from "@/components/patterns/bar-series";
import { MoneyText } from "@/components/patterns/money-text";
import { Toolbar, ToolbarGroup, ToolbarSpacer } from "@/components/patterns/toolbar";
import { useProjects } from "@/features/projects/hooks";
import { useVendors } from "@/features/procurement/hooks";
import { useContractors } from "@/features/contractors/hooks";
import {
  TRANSACTION_TYPES,
  TRANSACTION_TYPE_LABEL,
} from "@/features/payments/constants";
import { getReport } from "../registry";
import { useReport } from "../hooks";
import { REPORT_PERIODS } from "../constants";
import type { PeriodPreset, ReportFilters } from "../types";
import { ReportTable } from "./report-table";
import { ReportFilterSheet } from "./report-filter-sheet";

const ALL = "__all__";

export function ReportView({
  id,
  userId,
  isOwner,
  permissions,
  today,
  companyName,
}: {
  id: string;
  userId: string;
  isOwner: boolean;
  permissions: string[];
  /** Pinned server-side so the period a figure is labelled with cannot differ
   *  between the server render and the client. */
  today: string;
  /** Written into every export, so a file that leaves the building says whose. */
  companyName: string;
}) {
  const def = getReport(id);
  const can = useCan();
  const canExport = can("reports.export");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filterOpen, setFilterOpen] = React.useState(false);

  const filters: ReportFilters = React.useMemo(
    () => ({
      period: (searchParams.get("period") as PeriodPreset) ?? undefined,
      projectId: searchParams.get("project") ?? undefined,
      vendorId: searchParams.get("vendor") ?? undefined,
      contractorId: searchParams.get("contractor") ?? undefined,
      transactionType: searchParams.get("type") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      // Raw bounds are still honoured so deep links made before the period
      // presets existed keep meaning what they meant.
      dateFrom: searchParams.get("from") ?? undefined,
      dateTo: searchParams.get("to") ?? undefined,
    }),
    [searchParams],
  );

  const setParam = React.useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const { data: projects = [] } = useProjects({ includeArchived: true });
  const { data: vendors = [] } = useVendors({});
  const { data: contractors = [] } = useContractors({ status: "ALL" });
  const { data: result, isLoading, isFetching } = useReport(id, filters, {
    today,
    userId,
    isOwner,
    permissions,
  });

  /** Export is server-gated: the data never leaves via a download unless the
   *  caller can both view AND export it. */
  async function runExport(kind: "excel" | "csv" | "pdf") {
    if (!result) return;
    try {
      await authorizeReportExport(id);
    } catch {
      toast.error("You don't have permission to export this report.");
      return;
    }
    const ex = await import("../exporters");
    if (kind === "excel") await ex.reportToExcel(result, companyName);
    else if (kind === "csv") await ex.reportToCsv(result, companyName);
    else await ex.reportToPdf(result);
  }

  if (!def) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Report not found"
        description="This report doesn't exist."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href="/reports">Back to reports</Link>
          </Button>
        }
      />
    );
  }

  const hasPeriod = def.filters.includes("period");
  const secondaryKeys = def.filters.filter((k) => k === "transactionType" || k === "status");
  const secondaryCount =
    (filters.transactionType && secondaryKeys.includes("transactionType") ? 1 : 0) +
    (filters.status && secondaryKeys.includes("status") ? 1 : 0);

  const clearAll = () =>
    setParam({
      project: undefined,
      vendor: undefined,
      contractor: undefined,
      type: undefined,
      status: undefined,
    });
  const scopeCount =
    (filters.projectId ? 1 : 0) +
    (filters.vendorId ? 1 : 0) +
    (filters.contractorId ? 1 : 0) +
    secondaryCount;

  const header = (
    <div>
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-foreground-subtle">
        <Link href="/reports" className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Reports
        </Link>
        <ChevronRight className="size-3.5" aria-hidden="true" />
        <span aria-current="page">{def.name}</span>
      </nav>
      <PageHeader
        className="mt-2"
        title={def.name}
        description={def.question}
        meta={
          result ? (
            <span>
              Showing <span className="font-medium text-foreground">{result.periodLabel}</span>
              {isFetching && <span className="ml-2 text-foreground-subtle">Updating…</span>}
            </span>
          ) : undefined
        }
      />
    </div>
  );

  const toolbar = (
    <Toolbar aria-label={`${def.name} filters`}>
      {hasPeriod && (
        <ToolbarGroup>
          <Label htmlFor="report-period" className="sr-only">
            Period
          </Label>
          <Select
            value={filters.period ?? def.defaultPeriod ?? "THIS_MONTH"}
            onValueChange={(v) =>
              // Choosing a preset drops any raw bounds from an older link, so
              // the label and the rows can never describe different ranges.
              setParam({
                period: v,
                ...(v === "CUSTOM" ? {} : { from: undefined, to: undefined }),
              })
            }
          >
            <SelectTrigger id="report-period" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPORT_PERIODS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filters.period === "CUSTOM" && (
            <>
              <Label htmlFor="report-from" className="sr-only">
                From date
              </Label>
              <Input
                id="report-from"
                type="date"
                className="w-36"
                value={filters.dateFrom ?? ""}
                onChange={(e) => setParam({ from: e.target.value || undefined })}
              />
              <Label htmlFor="report-to" className="sr-only">
                To date
              </Label>
              <Input
                id="report-to"
                type="date"
                className="w-36"
                value={filters.dateTo ?? ""}
                onChange={(e) => setParam({ to: e.target.value || undefined })}
              />
            </>
          )}
        </ToolbarGroup>
      )}

      <ToolbarGroup>
        {def.filters.includes("project") && (
          <>
            <Label htmlFor="report-project" className="sr-only">
              Project
            </Label>
            <Select
              value={filters.projectId ?? ALL}
              onValueChange={(v) => setParam({ project: v === ALL ? undefined : v })}
            >
              <SelectTrigger id="report-project" className="w-44">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All projects</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        {def.filters.includes("vendor") && (
          <>
            <Label htmlFor="report-vendor" className="sr-only">
              Vendor
            </Label>
            <Select
              value={filters.vendorId ?? ALL}
              onValueChange={(v) => setParam({ vendor: v === ALL ? undefined : v })}
            >
              <SelectTrigger id="report-vendor" className="w-44">
                <SelectValue placeholder="All vendors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All vendors</SelectItem>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.businessName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        {def.filters.includes("contractor") && (
          <>
            <Label htmlFor="report-contractor" className="sr-only">
              Contractor
            </Label>
            <Select
              value={filters.contractorId ?? ALL}
              onValueChange={(v) => setParam({ contractor: v === ALL ? undefined : v })}
            >
              <SelectTrigger id="report-contractor" className="w-48">
                <SelectValue placeholder="All contractors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All contractors</SelectItem>
                {contractors.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        {secondaryKeys.length > 0 && (
          <Button variant="secondary" onClick={() => setFilterOpen(true)}>
            <SlidersHorizontal className="size-4" />
            More filters
            {secondaryCount > 0 && (
              <Badge variant="primary" className="ml-1">
                {secondaryCount}
              </Badge>
            )}
          </Button>
        )}
        {scopeCount > 0 && (
          <Button variant="ghost" onClick={clearAll}>
            <X className="size-4" />
            Clear
          </Button>
        )}
      </ToolbarGroup>

      <ToolbarSpacer />

      {canExport && (
        <ToolbarGroup>
          <Button
            variant="secondary"
            disabled={!result || result.isEmpty}
            onClick={() => runExport("excel")}
          >
            <FileSpreadsheet className="size-4" />
            Excel
          </Button>
          <Button
            variant="secondary"
            disabled={!result || result.isEmpty}
            onClick={() => runExport("csv")}
          >
            <Download className="size-4" />
            CSV
          </Button>
          <Button
            variant="secondary"
            disabled={!result || result.isEmpty}
            onClick={() => runExport("pdf")}
          >
            <Download className="size-4" />
            PDF
          </Button>
        </ToolbarGroup>
      )}
    </Toolbar>
  );

  return (
    <div className="space-y-6">
      {header}
      {toolbar}

      {result && result.activeFilters.length > 0 && (
        <ul className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted" aria-label="Active filters">
          {result.activeFilters.map((f) => (
            <li key={f.label} className="rounded-md border border-border bg-surface px-2 py-1">
              <span className="text-foreground-subtle">{f.label}:</span>{" "}
              <span className="text-foreground">{f.value}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Pending is not empty, and pending is not zero. Until the first result
          arrives the page shows its own SHAPE — the same tiles and rows that
          will replace it — rather than a bare block or a flash of ₹0. */}
      {isLoading || !result ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[104px] rounded-xl" />
            ))}
          </div>
          <div className="space-y-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        </div>
      ) : result.isEmpty ? (
        <EmptyState
          icon={Inbox}
          // The distinction Phase 5 and 6 both had to fix: a quiet period is not
          // a company with no history, and telling an established business it
          // has "nothing to report" is simply wrong.
          title={
            result.hasAnyData
              ? `Nothing in ${result.periodLabel}`
              : `No ${def.category.toLowerCase()} records yet`
          }
          description={
            result.hasAnyData
              ? "There are records in other periods or scopes. Widen the period, or clear a filter."
              : `${def.name} will fill in once the underlying records exist.`
          }
          action={
            result.hasAnyData && hasPeriod ? (
              <Button variant="secondary" onClick={() => setParam({ period: "ALL_TIME" })}>
                Show all time
              </Button>
            ) : scopeCount > 0 ? (
              <Button variant="secondary" onClick={clearAll}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {result.kpis.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {result.kpis.map((k) => (
                <StatCard
                  key={k.label}
                  label={`${k.label} · ${result.periodLabel}`}
                  // Money is shown in full — never the compact form, which
                  // rounds. The table below states the same figure exactly, and
                  // two different roundings of one number is how a report loses
                  // a reader's trust.
                  value={k.paise != null ? <MoneyText paise={k.paise} /> : k.value}
                  hint={k.hint}
                />
              ))}
            </div>
          )}

          {result.chart && (
            <section className="rounded-xl border border-border bg-surface p-5">
              <h2 className="text-sm font-medium">{result.chart.title}</h2>
              <p className="mt-0.5 text-xs text-foreground-subtle">{result.chart.description}</p>
              <BarSeries
                className="mt-4"
                points={result.chart.points}
                kind={result.chart.kind}
                description={result.chart.description}
              />
            </section>
          )}

          <ReportTable result={result} />

          {result.note && (
            <Callout tone="info" title="What these figures mean" icon={Info}>
              <p>{result.note}</p>
            </Callout>
          )}
        </>
      )}

      {secondaryKeys.length > 0 && (
        <ReportFilterSheet
          open={filterOpen}
          onOpenChange={setFilterOpen}
          keys={secondaryKeys}
          filters={filters}
          transactionTypes={TRANSACTION_TYPES.map((t) => ({
            value: t,
            label: TRANSACTION_TYPE_LABEL[t],
          }))}
          onChange={setParam}
        />
      )}
    </div>
  );
}
