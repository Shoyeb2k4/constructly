import Link from "next/link";
import {
  Inbox,
  CalendarClock,
  AlertTriangle,
  MoonStar,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MoneyText } from "@/components/patterns/money-text";
import { cn } from "@/lib/utils";
import type { DashboardSnapshot } from "../types";

type Row = {
  key: string;
  icon: React.ElementType;
  tone: "danger" | "warning" | "default";
  text: React.ReactNode;
  meta?: React.ReactNode;
  href: string;
};

export function AttentionCenter({
  attention,
  isOwner,
}: {
  attention: DashboardSnapshot["attention"];
  isOwner: boolean;
}) {
  const rows: Row[] = [];

  if (isOwner && attention.pendingPOs.length > 0) {
    const total = attention.pendingPOs.reduce((s, p) => s + p.totalPaise, 0);
    rows.push({
      key: "approvals",
      icon: Inbox,
      tone: "warning",
      text: `${attention.pendingPOs.length} purchase order${attention.pendingPOs.length > 1 ? "s" : ""} awaiting approval`,
      meta: <MoneyText paise={total} compact />,
      href: "/procurement",
    });
  }
  attention.overdueProjects.forEach((p) =>
    rows.push({ key: `od-${p.projectId}`, icon: AlertTriangle, tone: "danger", text: `${p.name} is overdue`, meta: `${p.daysOverdue}d`, href: `/projects/${p.projectId}` }),
  );
  attention.budgetWarnings.forEach((b) =>
    rows.push({ key: `bw-${b.projectId}`, icon: AlertTriangle, tone: b.overBudget ? "danger" : "warning", text: `${b.name} at ${b.utilizationPct}% of budget`, href: `/projects/${b.projectId}` }),
  );
  attention.upcomingDeadlines.forEach((d) =>
    rows.push({ key: `dl-${d.id}`, icon: CalendarClock, tone: d.daysLeft <= 3 ? "danger" : "warning", text: `${d.title} — ${d.projectName}`, meta: `${d.daysLeft}d`, href: `/projects/${d.projectId}` }),
  );
  attention.staleProjects.forEach((s) =>
    rows.push({ key: `st-${s.projectId}`, icon: MoonStar, tone: "default", text: `${s.name} — no activity in ${s.daysSinceActivity}d`, href: `/projects/${s.projectId}` }),
  );

  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between">
        <CardTitle>Needs attention</CardTitle>
        {rows.length > 0 && (
          <span className="text-xs text-foreground-muted">
            {rows.length} item{rows.length === 1 ? "" : "s"}
          </span>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <CheckCircle2 className="size-8 text-success" />
            <p className="text-sm font-medium">All clear</p>
            <p className="text-xs text-foreground-subtle">Nothing needs your attention right now.</p>
          </div>
        ) : (
          // Wide screens show these two-up: this is the lead section now, and a
          // single narrow column of seven rows wastes the width it was given.
          <div className="sm:grid sm:grid-cols-2">
          {rows.slice(0, 8).map((r) => {
            const Icon = r.icon;
            return (
              <Link key={r.key} href={r.href} className="flex items-center gap-3 border-b border-border px-5 py-3 transition-colors last:border-0 hover:bg-surface-muted/40">
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-lg",
                    r.tone === "danger" ? "bg-danger-subtle text-danger-foreground" : r.tone === "warning" ? "bg-warning-subtle text-warning-foreground" : "bg-surface-muted text-foreground-subtle",
                  )}
                >
                  <Icon className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{r.text}</span>
                {r.meta && <span className="shrink-0 font-mono text-xs text-foreground-muted">{r.meta}</span>}
                <ChevronRight className="size-4 shrink-0 text-foreground-subtle" />
              </Link>
            );
          })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
