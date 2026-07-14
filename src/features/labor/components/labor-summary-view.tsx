"use client";

import * as React from "react";
import { BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyText } from "@/components/patterns/money-text";
import { EmptyState } from "@/components/patterns/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useLaborCostByProject, useLaborCostByContractor } from "../hooks";
import { todayISO } from "../last-project";

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function LaborSummaryView() {
  const [from, setFrom] = React.useState(
    () => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
  );
  const [to, setTo] = React.useState(todayISO());
  const range = { from, to };

  const byProject = useLaborCostByProject(range);
  const byContractor = useLaborCostByContractor(range);

  const projTotal = (byProject.data ?? []).reduce((s, p) => s + p.totalPaise, 0);
  const projMax = Math.max(1, ...(byProject.data ?? []).map((p) => p.totalPaise));
  const contMax = Math.max(1, ...(byContractor.data ?? []).map((c) => c.totalPaise));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>From</Label>
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-44" />
        </div>
        <div className="space-y-1.5">
          <Label>To</Label>
          <Input type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} className="w-44" />
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs text-foreground-subtle">Total labor cost</p>
          <p className="text-xl font-semibold"><MoneyText paise={projTotal} /></p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Cost by project</CardTitle></CardHeader>
          <CardContent>
            {byProject.isLoading ? (
              <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : (byProject.data ?? []).length === 0 ? (
              <EmptyState icon={BarChart3} title="No labor recorded" description="No attendance in this date range." className="border-0 py-8" />
            ) : (
              <ul className="space-y-4">
                {byProject.data!.map((p) => (
                  <li key={p.projectId} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="truncate font-medium">{p.projectName}</span>
                      <span className="font-mono"><MoneyText paise={p.totalPaise} compact /></span>
                    </div>
                    <Bar value={p.totalPaise} max={projMax} />
                    <p className="text-xs text-foreground-subtle">
                      {p.workerCount} workers · {p.manDays} man-days
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Cost by contractor</CardTitle></CardHeader>
          <CardContent>
            {byContractor.isLoading ? (
              <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : (byContractor.data ?? []).length === 0 ? (
              <EmptyState icon={BarChart3} title="No labor recorded" description="No attendance in this date range." className="border-0 py-8" />
            ) : (
              <ul className="space-y-4">
                {byContractor.data!.map((c) => (
                  <li key={c.contractorId ?? "direct"} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="truncate font-medium">{c.name}</span>
                      <span className="font-mono"><MoneyText paise={c.totalPaise} compact /></span>
                    </div>
                    <Bar value={c.totalPaise} max={contMax} />
                    <p className="text-xs text-foreground-subtle">{c.workerCount} workers</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
