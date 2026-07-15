"use client";

import { HardHat, ShoppingCart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyText } from "@/components/patterns/money-text";
import { cn } from "@/lib/utils";
import { useProjectBudget } from "@/features/budget/hooks";

export function BudgetCard({
  projectId,
  budgetPaise,
  contractValuePaise,
}: {
  projectId: string;
  budgetPaise: number;
  contractValuePaise: number;
}) {
  const budget = useProjectBudget(projectId, budgetPaise);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Budget</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!budget ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-foreground-subtle">Used</p>
                <p className="text-2xl font-semibold">
                  <MoneyText paise={budget.usedPaise} compact />
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-foreground-subtle">Budget</p>
                <p className="text-lg font-medium">
                  <MoneyText paise={budget.budgetPaise} compact />
                </p>
              </div>
            </div>

            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  budget.overBudget ? "bg-danger" : budget.utilizationPct >= 90 ? "bg-warning" : "bg-primary",
                )}
                style={{ width: `${Math.min(100, Math.max(budget.budgetPaise > 0 ? 2 : 0, budget.utilizationPct))}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground-muted">{budget.utilizationPct}% utilized</span>
              <span className={budget.overBudget ? "text-danger-foreground" : "text-success-foreground"}>
                {budget.overBudget ? "Over by " : "Remaining "}
                <MoneyText paise={Math.abs(budget.remainingPaise)} compact />
              </span>
            </div>

            {budget.overBudget && (
              <div className="rounded-lg border border-warning/40 bg-warning-subtle/50 px-3 py-2 text-xs text-warning-foreground">
                ⚠ This project is over budget. Review procurement and labor spend.
              </div>
            )}

            <div className="space-y-1 border-t border-border pt-3">
              <Breakdown icon={HardHat} label="Labor cost" paise={budget.laborPaise} />
              <Breakdown icon={ShoppingCart} label="Procurement cost" paise={budget.procurementPaise} />
              <div className="flex items-center justify-between pt-1 text-sm">
                <span className="font-medium">Total used</span>
                <span className="font-mono font-medium"><MoneyText paise={budget.usedPaise} compact /></span>
              </div>
              <div className="flex items-center justify-between pt-1 text-xs text-foreground-subtle">
                <span>Contract value</span>
                <span className="font-mono"><MoneyText paise={contractValuePaise} compact /></span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Breakdown({ icon: Icon, label, paise }: { icon: React.ElementType; label: string; paise: number }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="flex items-center gap-2 text-foreground-muted">
        <Icon className="size-4 text-foreground-subtle" />
        {label}
      </span>
      <span className="font-mono"><MoneyText paise={paise} compact /></span>
    </div>
  );
}
