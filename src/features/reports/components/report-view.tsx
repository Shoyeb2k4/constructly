"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ChevronRight, Download, FileSpreadsheet, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/patterns/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProjects } from "@/features/projects/hooks";
import { useVendors } from "@/features/procurement/hooks";
import { getReport } from "../registry";
import { useReport } from "../hooks";
import { reportToPdf, reportToExcel } from "../exporters";
import type { ReportFilters } from "../types";
import { ReportTable } from "./report-table";

const ALL = "__all__";

export function ReportView({ id }: { id: string }) {
  const def = getReport(id);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters: ReportFilters = {
    projectId: searchParams.get("project") ?? undefined,
    vendorId: searchParams.get("vendor") ?? undefined,
    dateFrom: searchParams.get("from") ?? undefined,
    dateTo: searchParams.get("to") ?? undefined,
  };

  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const { data: projects = [] } = useProjects({ includeArchived: true });
  const { data: vendors = [] } = useVendors({});
  const { data: result, isLoading } = useReport(id, filters);

  if (!def) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Report not found"
        description="This report doesn't exist."
        action={<Button asChild variant="secondary" size="sm"><Link href="/reports">Back to reports</Link></Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <nav className="flex items-center gap-1 text-sm text-foreground-subtle">
          <Link href="/reports" className="hover:text-foreground">Reports</Link>
          <ChevronRight className="size-3.5" />
          <span>{def.name}</span>
        </nav>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{def.name}</h1>
        <p className="text-sm text-foreground-muted">{def.description}</p>
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 py-4">
          {def.filters.includes("project") && (
            <div className="space-y-1.5">
              <Label className="text-xs">Project</Label>
              <Select value={filters.projectId ?? ALL} onValueChange={(v) => setParam("project", v === ALL ? undefined : v)}>
                <SelectTrigger className="h-9 w-56"><SelectValue placeholder="All projects" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All projects</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {def.filters.includes("vendor") && (
            <div className="space-y-1.5">
              <Label className="text-xs">Vendor</Label>
              <Select value={filters.vendorId ?? ALL} onValueChange={(v) => setParam("vendor", v === ALL ? undefined : v)}>
                <SelectTrigger className="h-9 w-52"><SelectValue placeholder="All vendors" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All vendors</SelectItem>
                  {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.businessName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {def.filters.includes("dateRange") && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">From</Label>
                <Input type="date" className="h-9 w-40" value={filters.dateFrom ?? ""} onChange={(e) => setParam("from", e.target.value || undefined)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">To</Label>
                <Input type="date" className="h-9 w-40" value={filters.dateTo ?? ""} onChange={(e) => setParam("to", e.target.value || undefined)} />
              </div>
            </>
          )}

          <div className="ml-auto flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!result || result.isEmpty}
              onClick={() => result && reportToExcel(result)}
            >
              <FileSpreadsheet />
              Excel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!result || result.isEmpty}
              onClick={() => result && reportToPdf(result)}
            >
              <Download />
              PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading || !result ? (
        <Skeleton className="h-80 rounded-xl" />
      ) : result.isEmpty ? (
        <EmptyState
          icon={BarChart3}
          title="Nothing to report"
          description="No data matches these filters yet. Adjust the range or scope."
        />
      ) : (
        <>
          {result.kpis.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {result.kpis.map((k) => (
                <div key={k.label} className="rounded-xl border border-border bg-surface p-4">
                  <p className="text-xs text-foreground-subtle">{k.label}</p>
                  <p className="mt-1 text-lg font-semibold">{k.value}</p>
                </div>
              ))}
            </div>
          )}
          <ReportTable result={result} />
        </>
      )}
    </div>
  );
}
