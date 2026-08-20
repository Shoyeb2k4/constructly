"use client";

import * as React from "react";
import { BarChart3, Download, FileSpreadsheet, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/patterns/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoneyText } from "@/components/patterns/money-text";
import { Toolbar, ToolbarGroup, ToolbarSpacer } from "@/components/patterns/toolbar";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/patterns/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjects } from "@/features/projects/hooks";
import { useLabourSummary, useAttendanceList } from "../hooks";
// exports.ts (jsPDF + SheetJS) is lazy-loaded on click — see handlers below.
import { todayISO } from "../last-project";

export function LaborSummaryView() {
  const [from, setFrom] = React.useState(
    () => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
  );
  const [to, setTo] = React.useState(() => todayISO());
  const [projectId, setProjectId] = React.useState("ALL");

  const filters = { projectId, from, to };
  const { data: projects = [] } = useProjects({});
  const { data: summary, isLoading } = useLabourSummary(filters);
  const { data: records = [] } = useAttendanceList(filters);

  const scope = projectId === "ALL" ? "All projects" : (projects.find((p) => p.id === projectId)?.name ?? "");
  const maxCat = Math.max(1, ...(summary?.byCategory ?? []).map((c) => c.manDays));
  const maxDay = Math.max(1, ...(summary?.trend ?? []).map((t) => t.total));

  return (
    <div className="space-y-6">
      {/* Same toolbar shape as Attendance and the Contractor list: what you
          are looking at first, exports last and collapsible. */}
      <Toolbar aria-label="Labour summary filters" className="items-end">
        <Field label="Project" className="w-full sm:w-52">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="w-full" aria-label="Filter by project">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All projects</SelectItem>
              {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="From">
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </Field>
        <Field label="To">
          <Input type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </Field>
        <ToolbarSpacer />
        <ToolbarGroup>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" disabled={!summary || summary.totalManDays === 0}>
                <Download className="size-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={async () => { if (summary) (await import("../exports")).exportRangePdf({ records, summary, from, to, scope }); }}
              >
                <FileText />
                PDF
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={async () => { if (summary) (await import("../exports")).exportRangeExcel({ records, summary, from, to, scope }); }}
              >
                <FileSpreadsheet />
                Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ToolbarGroup>
      </Toolbar>

      {isLoading || !summary ? (
        <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : summary.totalManDays === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No labour recorded"
          description="No attendance in this date range. Record attendance to see man-days and trends."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Total man-days" value={summary.totalManDays} />
            {/* "Attendance value", not "cost" and certainly not "due": this is
                what the recorded quantities are worth at their snapshot rates.
                Whether any of it has been settled is a contractor-side figure. */}
            <StatCard
              label="Attendance value"
              value={<MoneyText paise={summary.estimatedCostPaise} compact />}
              hint="At the rate snapshotted on each day."
            />
            <StatCard label="Working days" value={summary.trend.length} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* A table, not bars: the question here is "who, how many, how
                much", and three aligned columns answer it faster than three
                proportional widths the eye has to estimate. */}
            <Card>
              <CardHeader><CardTitle>Man-days by contractor</CardTitle></CardHeader>
              <CardContent>
                <DataTable
                  // Distinct from the card heading above it: a screen reader
                  // should not hear the same phrase twice in a row.
                  caption="Contractors and their man-days"
                  rows={summary.byContractor}
                  getRowKey={(c) => c.contractorId ?? "unattributed"}
                  className="border-0"
                  columns={[
                    {
                      key: "name",
                      header: "Contractor",
                      cell: (c) =>
                        c.contractorId ? (
                          <span className="font-medium">{c.name}</span>
                        ) : (
                          // Labour recorded without a contractor is not a
                          // contractor called "Unattributed" — say so plainly,
                          // and never in language that implies money is missing.
                          <span className="flex items-center gap-2">
                            <span className="text-foreground-muted">Not assigned to a contractor</span>
                            <Badge variant="neutral">Unattributed</Badge>
                          </span>
                        ),
                    },
                    {
                      key: "manDays",
                      header: "Man-days",
                      numeric: true,
                      cell: (c) => c.manDays,
                    },
                    {
                      key: "value",
                      header: "Attendance value",
                      numeric: true,
                      cell: (c) => <MoneyText paise={c.estimatedCostPaise} compact />,
                    },
                  ]}
                />
                <div className="flex items-center justify-between gap-3 border-t border-border pt-2 text-sm font-semibold">
                  <span>Grand total</span>
                  <span className="font-mono tabular-nums">
                    {summary.totalManDays} · <MoneyText paise={summary.estimatedCostPaise} compact />
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Man-days by trade group → labour type (master-data breakdown). */}
            <Card>
              <CardHeader><CardTitle>Man-days by trade group</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {summary.byCategory.map((c) => (
                  <div key={c.categoryId} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm font-semibold">
                      <span className="flex items-center gap-2">
                        <span className="size-2.5 rounded-full" style={{ background: c.color ?? "#64748B" }} />
                        {c.name}
                      </span>
                      <span className="font-mono text-xs">
                        {c.manDays} · <MoneyText paise={c.estimatedCostPaise} compact />
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.max(2, (c.manDays / maxCat) * 100)}%`, background: c.color ?? "#64748B" }}
                      />
                    </div>
                    <div className="space-y-0.5 pl-4">
                      {c.subcategories.map((s) => (
                        <div key={s.subcategoryId} className="flex items-center justify-between text-xs text-foreground-muted">
                          <span className="truncate">{s.name}</span>
                          <span className="font-mono">
                            {s.manDays} · <MoneyText paise={s.estimatedCostPaise} compact />
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-border pt-2 text-sm font-semibold">
                  <span>Grand total</span>
                  <span className="font-mono">
                    {summary.totalManDays} · <MoneyText paise={summary.estimatedCostPaise} compact />
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Labour trend */}
            <Card>
              <CardHeader><CardTitle>Labour trend</CardTitle></CardHeader>
              <CardContent>
                <div className="flex h-36 items-end gap-px">
                  {summary.trend.map((t) => (
                    <div
                      key={t.date}
                      title={`${t.date}: ${t.total} workers`}
                      className="flex-1 rounded-t-sm bg-primary transition-all"
                      style={{ height: `${Math.max(3, (t.total / maxDay) * 100)}%` }}
                    />
                  ))}
                </div>
                <p className="mt-3 text-xs text-foreground-subtle">Workers per day, {from} → {to}</p>
              </CardContent>
            </Card>
          </div>

          {/* By project */}
          <Card>
            <CardHeader><CardTitle>By project</CardTitle></CardHeader>
            <CardContent className="divide-y divide-border py-0">
              {summary.byProject.map((p) => (
                <div key={p.projectId} className="flex items-center justify-between py-3 text-sm">
                  <span className="truncate font-medium">{p.projectName}</span>
                  <span className="font-mono text-foreground-muted">
                    {p.manDays} man-days · <MoneyText paise={p.estimatedCostPaise} compact />
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
