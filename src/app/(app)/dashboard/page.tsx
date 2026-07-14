import type { Metadata } from "next";
import Link from "next/link";
import {
  FolderKanban,
  CalendarClock,
  HardHat,
  Wallet,
  ArrowRight,
  Activity,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isDemoMode } from "@/lib/env";
import { toPaise, type Paise } from "@/lib/money";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { MoneyText } from "@/components/patterns/money-text";
import { EmptyState } from "@/components/patterns/empty-state";
import { ComingSoonButton } from "@/components/patterns/coming-soon-button";
import {
  StatusBadge,
  PROJECT_STAGE_META,
} from "@/components/patterns/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const metadata: Metadata = { title: "Dashboard" };

type DemoProject = {
  name: string;
  code: string;
  stage: string;
  used: Paise;
  budget: Paise;
  daysLeft: number;
};

const DEMO_PROJECTS: DemoProject[] = [
  { name: "Skyline Residency", code: "PRJ-0142", stage: "CONSTRUCTION", used: toPaise(9_240_000), budget: toPaise(12_000_000), daysLeft: 64 },
  { name: "Orion Tech Park", code: "PRJ-0138", stage: "PROCUREMENT", used: toPaise(3_100_000), budget: toPaise(21_000_000), daysLeft: 128 },
  { name: "Vermillion Villas", code: "PRJ-0151", stage: "QUALITY_INSPECTION", used: toPaise(18_800_000), budget: toPaise(19_000_000), daysLeft: 12 },
];

const DEMO_ACTIVITY = [
  { who: "Priya Nair", what: "recorded attendance for 18 workers at Skyline Residency", when: "2h ago" },
  { who: "Aarav Mehta", what: "approved PO-0231 for UltraTech Cement (₹4.8L)", when: "5h ago" },
  { who: "Priya Nair", what: "uploaded structural drawings to Orion Tech Park", when: "Yesterday" },
  { who: "Aarav Mehta", what: "created project Vermillion Villas", when: "2 days ago" },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function BudgetMeter({ used, budget }: { used: Paise; budget: Paise }) {
  const pct = Math.min(100, Math.round((used / budget) * 100));
  const over = used > budget;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
      <div
        className={cn("h-full rounded-full", over ? "bg-danger" : "bg-primary")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const firstName = user?.fullName.split(" ")[0] ?? "there";
  const demo = isDemoMode;

  return (
    <div className="space-y-8">
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description="Here's how your projects are tracking today."
        actions={<ComingSoonButton label="New project" module="Projects" />}
      />

      {demo && (
        <div className="flex items-center gap-2 text-xs text-foreground-subtle">
          <Badge variant="primary">Demo data</Badge>
          <span>Sample overview — live figures populate as modules are built.</span>
        </div>
      )}

      {/* Executive KPIs — readable in seconds */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active projects"
          value="6"
          icon={FolderKanban}
          hint="2 nearing deadline"
        />
        <StatCard
          label="Upcoming deadlines"
          value="3"
          icon={CalendarClock}
          hint="Next in 12 days"
          tone="warning"
        />
        <StatCard
          label="Today's labor"
          value="42"
          icon={HardHat}
          hint="Across 4 sites"
        />
        <StatCard
          label="Budget deployed"
          value={<MoneyText paise={toPaise(4_20_00_000)} compact />}
          icon={Wallet}
          hint="of ₹5.2Cr allocated"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Active projects */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Active projects</CardTitle>
            <Link
              href="/projects"
              className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              View all <ArrowRight className="size-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-1">
            {DEMO_PROJECTS.map((p, i) => (
              <div key={p.code}>
                {i > 0 && <Separator className="my-1" />}
                <div className="flex items-center gap-4 rounded-lg px-2 py-3 transition-colors hover:bg-surface-muted/60">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {p.name}
                      </span>
                      <span className="font-mono text-xs text-foreground-subtle">
                        {p.code}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <BudgetMeter used={p.used} budget={p.budget} />
                      <span className="whitespace-nowrap font-mono text-xs text-foreground-muted">
                        <MoneyText paise={p.used} compact /> /{" "}
                        <MoneyText paise={p.budget} compact />
                      </span>
                    </div>
                  </div>
                  <div className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
                    <StatusBadge meta={PROJECT_STAGE_META} value={p.stage} />
                    <span
                      className={cn(
                        "text-xs",
                        p.daysLeft <= 14
                          ? "text-danger-foreground"
                          : "text-foreground-subtle",
                      )}
                    >
                      {p.daysLeft} days left
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {DEMO_ACTIVITY.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="No activity yet"
                description="Actions across your team show up here."
                className="border-0 py-8"
              />
            ) : (
              <ul className="space-y-4">
                {DEMO_ACTIVITY.map((a, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                    <div className="min-w-0">
                      <p className="text-sm leading-snug">
                        <span className="font-medium">{a.who}</span>{" "}
                        <span className="text-foreground-muted">{a.what}</span>
                      </p>
                      <span className="text-xs text-foreground-subtle">
                        {a.when}
                      </span>
                    </div>
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
