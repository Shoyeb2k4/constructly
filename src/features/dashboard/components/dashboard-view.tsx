"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatGridSkeleton } from "@/components/patterns/loading-state";
import { ErrorState } from "@/components/patterns/error-state";
import { MoneyText } from "@/components/patterns/money-text";
import { useDashboard } from "../hooks";
import type { DashboardSnapshot } from "../types";
import Link from "next/link";
import { StatCard } from "@/components/patterns/stat-card";
import { SpendTrendChart } from "./charts/spend-trend-chart";
import { CostSplitDonut } from "./charts/cost-split-donut";
import { BudgetHealthCard } from "./budget-health-card";
import { AttentionCenter } from "./attention-center";
import { ActivityFeed } from "./activity-feed";
import { LabourCard } from "./labour-card";
import { ProcurementCard } from "./procurement-card";
import { QuickActions } from "./quick-actions";
import { OnboardingDashboard } from "./onboarding-dashboard";

export function DashboardView({
  userId,
  isOwner,
  greeting,
  firstName,
  companyName,
  logoUrl,
  initialData,
}: {
  userId: string;
  isOwner: boolean;
  greeting: string;
  firstName: string;
  companyName?: string;
  logoUrl?: string | null;
  initialData?: DashboardSnapshot;
}) {
  const { data, isLoading, isError, error, refetch } = useDashboard(userId, isOwner, initialData);

  // A failed aggregation must surface, not sit behind skeletons forever.
  if (isError) {
    return (
      <ErrorState
        title="Couldn't load your dashboard"
        description="The overview failed to assemble. Your data is safe — try again."
        onRetry={() => refetch()}
        detail={error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)}
      />
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-8">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
        <StatGridSkeleton count={6} />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      </div>
    );
  }

  if (data.isEmpty) return <OnboardingDashboard firstName={firstName} />;

  const k = data.kpis;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL
            <img
              src={logoUrl}
              alt={companyName ?? "Company logo"}
              className="size-11 shrink-0 rounded-lg border border-border object-contain"
            />
          )}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{greeting}, {firstName}</h1>
            <p className="text-sm text-foreground-muted">
              {companyName ? (
                <span className="font-medium text-foreground">{companyName}</span>
              ) : (
                "Here's your company at a glance."
              )}
            </p>
          </div>
        </div>
        <QuickActions />
      </div>

      {/* LEVEL 1 — ATTENTION, first and full width. It was previously the
          bottom-left card of the last row: the one section that answers "what
          needs me now" sat below three charts. */}
      <AttentionCenter attention={data.attention} isOwner={isOwner} />

      {/* LEVEL 2 — OPERATIONAL PULSE. Three primary cards, not six equal ones.
          Every figure states its PERIOD, because a lifetime total and a today
          total in the same row is how ₹ figures get misread. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Each headline still drills into its source module — that affordance
            was the one good thing about the old six-card row. */}
        <Link href="/projects" className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <StatCard
          label="Active projects"
          value={k.activeProjects}
          hint={
            k.overdue > 0
              ? `${k.overdue} overdue · ${k.upcomingDeadlines} deadline${k.upcomingDeadlines === 1 ? "" : "s"} soon`
              : `${k.upcomingDeadlines} deadline${k.upcomingDeadlines === 1 ? "" : "s"} coming up`
          }
          tone={k.overdue > 0 ? "attention" : "default"}
        />
        </Link>
        <Link href="/labor" className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <StatCard
          label="Attendance value — today"
          value={<MoneyText paise={k.todaysWagesPaise} />}
          // The caveat belongs to the LABEL, not to the presence of data: the
          // figure means the same thing at zero, and a reader meeting it for
          // the first time on an empty day still needs to know it is not a
          // payable.
          hint={
            <>
              {k.todaysLaborCount > 0
                ? `${k.todaysLaborCount} present today. `
                : "No attendance recorded today yet. "}
              Unsettled until a settlement runs.
            </>
          }
        />
        </Link>
        <Link href="/procurement" className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <StatCard
          label="Awaiting approval"
          value={k.pendingApprovals}
          hint="Purchase orders. Not counted toward budget until approved."
          tone={k.pendingApprovals > 0 ? "attention" : "default"}
        />
        </Link>
      </div>

      {/* Where to go next. Plain links, not six more bordered boxes. */}
      <nav aria-label="Jump to a module" className="flex flex-wrap gap-2">
        {[
          { href: "/projects", label: "All projects" },
          { href: "/labor", label: "Record attendance" },
          { href: "/labor/summary", label: "Labour summary" },
          { href: "/labor/contractors", label: "Contractors" },
          { href: "/procurement", label: "Purchase orders" },
          // Routing only. The dashboard gains no payments AGGREGATE: it has no
          // canonical cross-instrument cash figure, and inventing one here
          // would be the very total the Payments Centre refuses to compute.
          { href: "/payments", label: "Payments" },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {l.label}
          </Link>
        ))}
      </nav>

      {/* LEVEL 3 — COMMERCIAL CONTEXT. Budget is a PROJECT concept and is
          labelled as one; it is deliberately not netted against procurement or
          contractor figures, which are different instruments. */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="flex-row items-baseline justify-between">
            <CardTitle>Spend trend</CardTitle>
            <div className="flex items-center gap-3 text-[11px] text-foreground-muted">
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-primary" />Procurement</span>
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-warning" />Labour</span>
            </div>
          </CardHeader>
          <CardContent>
            <SpendTrendChart data={data.spendTrend} />
            <p className="mt-3 text-xs text-foreground-muted">Weekly, last 8 weeks</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Cost split</CardTitle></CardHeader>
          <CardContent className="flex flex-col items-center justify-center py-2">
            <CostSplitDonut laborPaise={data.costSplit.laborPaise} procurementPaise={data.costSplit.procurementPaise} />
            <p className="mt-3 text-xs text-foreground-muted">Attendance value vs ordered value, lifetime</p>
          </CardContent>
        </Card>

        <BudgetHealthCard items={data.budgetHealth} budgetUsedPaise={k.budgetUsedPaise} budgetTotalPaise={k.budgetTotalPaise} />
      </div>

      <ProcurementCard procurement={data.procurement} />

      <div className="grid gap-6 lg:grid-cols-2">
        <LabourCard labour={data.labour} />
        <ActivityFeed items={data.recentActivity} />
      </div>
    </div>
  );
}
