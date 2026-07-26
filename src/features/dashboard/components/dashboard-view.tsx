"use client";

import {
  FolderKanban,
  CalendarClock,
  AlertTriangle,
  HardHat,
  Wallet,
  Inbox,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatGridSkeleton } from "@/components/patterns/loading-state";
import { ErrorState } from "@/components/patterns/error-state";
import { MoneyText } from "@/components/patterns/money-text";
import { formatPaiseCompact } from "@/lib/money";
import { useDashboard } from "../hooks";
import type { DashboardSnapshot } from "../types";
import { KpiCard } from "./kpi-card";
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
    <div className="space-y-6">
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

      {/* KPI row — every card drills down */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Active projects" value={k.activeProjects} icon={FolderKanban} href="/projects" />
        <KpiCard label="Upcoming deadlines" value={k.upcomingDeadlines} icon={CalendarClock} href="/projects" tone={k.upcomingDeadlines > 0 ? "warning" : "default"} />
        <KpiCard label="Overdue" value={k.overdue} icon={AlertTriangle} href="/projects" tone={k.overdue > 0 ? "danger" : "default"} />
        <KpiCard label="Today's labor" value={k.todaysLaborCount} hint={k.todaysWagesPaise > 0 ? `${formatPaiseCompact(k.todaysWagesPaise)} wages` : "Not recorded yet"} icon={HardHat} href="/labor" />
        <KpiCard label="Budget used" value={<MoneyText paise={k.budgetUsedPaise} compact />} hint={`of ${formatPaiseCompact(k.budgetTotalPaise)}`} icon={Wallet} href="/projects" />
        <KpiCard label="Pending approvals" value={k.pendingApprovals} icon={Inbox} href="/procurement" tone={k.pendingApprovals > 0 ? "warning" : "default"} />
      </div>

      {/* Charts + budget health */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="flex-row items-baseline justify-between">
            <CardTitle>Spend trend</CardTitle>
            <div className="flex items-center gap-3 text-[11px] text-foreground-subtle">
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-primary" />Procurement</span>
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-warning" />Labor</span>
            </div>
          </CardHeader>
          <CardContent>
            <SpendTrendChart data={data.spendTrend} />
            <p className="mt-3 text-xs text-foreground-subtle">Weekly, last 8 weeks</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Cost split</CardTitle></CardHeader>
          <CardContent className="flex items-center justify-center py-2">
            <CostSplitDonut laborPaise={data.costSplit.laborPaise} procurementPaise={data.costSplit.procurementPaise} />
          </CardContent>
        </Card>

        <BudgetHealthCard items={data.budgetHealth} budgetUsedPaise={k.budgetUsedPaise} budgetTotalPaise={k.budgetTotalPaise} />
      </div>

      {/* Procurement command center (full width) */}
      <ProcurementCard procurement={data.procurement} />

      {/* Attention + labour + activity */}
      <div className="grid gap-6 lg:grid-cols-3">
        <AttentionCenter attention={data.attention} isOwner={isOwner} />
        <LabourCard labour={data.labour} />
        <ActivityFeed items={data.recentActivity} />
      </div>
    </div>
  );
}
