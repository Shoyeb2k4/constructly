"use client";

import Link from "next/link";
import { Users, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MoneyText } from "@/components/patterns/money-text";
import { cn } from "@/lib/utils";
import { formatDate } from "@/features/projects/format";
import { useLabourSummary } from "../hooks";

/** Project-scoped labour summary: man-days, cost, categories, recent trend. */
export function ProjectLabourTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useLabourSummary({ projectId });

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  const workingDays = data.trend.filter((t) => t.total > 0).length;
  const maxTrend = Math.max(1, ...data.trend.map((t) => t.total));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground-muted">Labour on this project</h3>
        <Button asChild variant="secondary" size="sm">
          <Link href={`/labor?project=${projectId}`}>
            Record attendance
            <ArrowRight />
          </Link>
        </Button>
      </div>

      {data.totalManDays === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Users className="mx-auto size-8 text-foreground-subtle" />
            <p className="mt-2 text-sm text-foreground-muted">No attendance recorded for this project yet.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs text-foreground-subtle">Man-days</p>
              <p className="mt-1 text-lg font-semibold">{data.totalManDays}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs text-foreground-subtle">Est. labour cost</p>
              <p className="mt-1 text-lg font-semibold"><MoneyText paise={data.estimatedCostPaise} compact /></p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs text-foreground-subtle">Working days</p>
              <p className="mt-1 text-lg font-semibold">{workingDays}</p>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>By category</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {data.byCategory.map((c) => (
                  <div key={c.categoryId}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className="size-2.5 rounded-full" style={{ backgroundColor: c.color ?? "var(--color-primary)" }} />
                        {c.name}
                      </span>
                      <span className="font-mono text-foreground-muted">{c.manDays} md · <MoneyText paise={c.estimatedCostPaise} compact /></span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(3, Math.round((c.manDays / data.totalManDays) * 100))}%`,
                          backgroundColor: c.color ?? "var(--color-primary)",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
              <CardContent>
                <div className="flex h-32 items-end gap-1">
                  {data.trend.slice(-21).map((t) => (
                    <div key={t.date} className="flex flex-1 flex-col items-center gap-1" title={`${formatDate(t.date)}: ${t.total}`}>
                      <div
                        className={cn("w-full rounded-t bg-primary/70", t.total === 0 && "bg-surface-muted")}
                        style={{ height: `${Math.max(2, Math.round((t.total / maxTrend) * 100))}%` }}
                      />
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-center text-xs text-foreground-subtle">Headcount over the last {Math.min(21, data.trend.length)} days</p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
