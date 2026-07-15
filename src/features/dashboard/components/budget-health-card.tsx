import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MoneyText } from "@/components/patterns/money-text";
import { cn } from "@/lib/utils";
import type { BudgetHealthItem } from "../types";

export function BudgetHealthCard({
  items,
  budgetUsedPaise,
  budgetTotalPaise,
}: {
  items: BudgetHealthItem[];
  budgetUsedPaise: number;
  budgetTotalPaise: number;
}) {
  const util = budgetTotalPaise > 0 ? Math.round((budgetUsedPaise / budgetTotalPaise) * 100) : 0;
  const remaining = budgetTotalPaise - budgetUsedPaise;

  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between">
        <CardTitle>Budget health</CardTitle>
        <span className="text-xs text-foreground-subtle">{util}% overall</span>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between text-sm">
          <span>
            <span className="font-semibold"><MoneyText paise={budgetUsedPaise} compact /></span>
            <span className="text-foreground-subtle"> of <MoneyText paise={budgetTotalPaise} compact /></span>
          </span>
          <span className={remaining < 0 ? "text-danger-foreground" : "text-success-foreground"}>
            {remaining < 0 ? "Over " : ""}
            <MoneyText paise={Math.abs(remaining)} compact /> {remaining < 0 ? "" : "left"}
          </span>
        </div>

        <div className="space-y-2.5 pt-1">
          {items.slice(0, 5).map((b) => (
            <Link key={b.projectId} href={`/projects/${b.projectId}`} className="block space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="truncate font-medium">{b.name}</span>
                <span className={cn(b.overBudget ? "text-danger-foreground" : "text-foreground-muted")}>
                  {b.utilizationPct}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className={cn(
                    "h-full rounded-full",
                    b.overBudget ? "bg-danger" : b.utilizationPct >= 90 ? "bg-warning" : "bg-primary",
                  )}
                  style={{ width: `${Math.min(100, Math.max(b.budgetPaise > 0 ? 2 : 0, b.utilizationPct))}%` }}
                />
              </div>
            </Link>
          ))}
          {items.length === 0 && <p className="text-sm text-foreground-subtle">No active projects.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
