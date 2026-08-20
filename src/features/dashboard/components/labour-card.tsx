import Link from "next/link";
import { HardHat, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MoneyText } from "@/components/patterns/money-text";
import type { LabourWidget } from "../types";

export function LabourCard({ labour }: { labour: LabourWidget }) {
  const maxDay = Math.max(1, ...labour.trend.map((t) => t.total));
  const todayTotal = labour.todayByCategory.reduce((s, c) => s + c.quantity, 0);

  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between">
        <CardTitle>Labour</CardTitle>
        <Link href="/labor" className="flex items-center gap-0.5 text-xs font-medium text-primary hover:underline">
          Attendance <ArrowUpRight className="size-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-foreground-muted">Present · today</p>
            <p className="text-2xl font-semibold leading-none">{todayTotal}</p>
          </div>
          <div className="text-right">
            {/* The Labour module's word for this figure. Never "labour payable"
                or "labour due" — it becomes agreement credit only when a
                settlement recognises it. */}
            <p className="text-xs text-foreground-muted">Attendance value · today</p>
            <p className="text-lg font-semibold leading-none">
              <MoneyText paise={labour.todayCostPaise} />
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-foreground-subtle">Man-days · 30d</p>
            <p className="text-lg font-medium leading-none">{labour.manDays30}</p>
          </div>
        </div>

        {labour.todayByCategory.length > 0 ? (
          <div className="space-y-1.5">
            {labour.todayByCategory.slice(0, 4).map((c) => (
              <div key={c.name}>
                <div className="flex items-center justify-between text-sm font-medium">
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ background: c.color }} />
                    {c.name}
                  </span>
                  <span className="font-mono tabular-nums text-foreground-muted">{c.quantity}</span>
                </div>
                <div className="space-y-0.5 pl-4">
                  {c.subcategories.slice(0, 3).map((s) => (
                    <div key={s.name} className="flex items-center justify-between text-xs text-foreground-subtle">
                      <span className="truncate">{s.name}</span>
                      <span className="font-mono tabular-nums">{s.quantity}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border-strong py-4 text-center">
            <HardHat className="size-5 text-foreground-subtle" />
            <p className="text-xs text-foreground-muted">No attendance recorded today</p>
            <Link href="/labor" className="text-xs font-medium text-primary hover:underline">
              Record now
            </Link>
          </div>
        )}

        {labour.trend.length > 1 && (
          <div>
            <div className="flex h-12 items-end gap-px">
              {labour.trend.map((t) => (
                <div
                  key={t.date}
                  title={`${t.date}: ${t.total}`}
                  className="flex-1 rounded-t-sm bg-primary/70"
                  style={{ height: `${Math.max(6, (t.total / maxDay) * 100)}%` }}
                />
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-foreground-subtle">Workers per day, last {labour.trend.length} working days</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
