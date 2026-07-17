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
  procurementBudgetPaise,
}: {
  projectId: string;
  budgetPaise: number;
  contractValuePaise: number;
  procurementBudgetPaise: number | null;
}) {
  const budget = useProjectBudget(projectId, budgetPaise);
  // Procurement is tracked against its own dedicated budget (ADR-0024),
  // independent of the overall project budget.
  const procUsed = budget?.procurementPaise ?? 0;
  const procRemaining = procurementBudgetPaise == null ? null : procurementBudgetPaise - procUsed;
  const procOver = procRemaining != null && procRemaining < 0;
  const procPct =
    procurementBudgetPaise && procurementBudgetPaise > 0
      ? Math.min(100, Math.round((procUsed / procurementBudgetPaise) * 100))
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Budget</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {!budget ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            {/* ── Overall project budget ─────────────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs text-foreground-subtle">Overall budget used</p>
                  <p className="text-2xl font-semibold">
                    <MoneyText paise={budget.usedPaise} compact />
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-foreground-subtle">Total project budget</p>
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
            </div>

            {budget.overBudget && (
              <div className="rounded-lg border border-warning/40 bg-warning-subtle/50 px-3 py-2 text-xs text-warning-foreground">
                ⚠ This project is over budget. Review procurement and labor spend.
              </div>
            )}

            <div className="space-y-1 border-t border-border pt-3">
              <Breakdown icon={HardHat} label="Labor cost" paise={budget.laborPaise} />
              <Breakdown icon={ShoppingCart} label="Procurement cost" paise={budget.procurementPaise} />
              <div className="flex items-center justify-between pt-1 text-xs text-foreground-subtle">
                <span>Contract value</span>
                <span className="font-mono"><MoneyText paise={contractValuePaise} compact /></span>
              </div>
            </div>

            {/* ── Dedicated procurement budget (ADR-0024) ────────────── */}
            <div className="space-y-2 rounded-lg border border-border bg-surface-muted/30 p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground-muted">
                <ShoppingCart className="size-3.5 text-foreground-subtle" />
                Procurement budget
              </div>
              {procurementBudgetPaise == null ? (
                <p className="text-sm text-foreground-subtle">
                  Not set — add a dedicated materials budget to track procurement separately.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <BudgetStat label="Budget" paise={procurementBudgetPaise} />
                    <BudgetStat label="Used" paise={procUsed} />
                    <BudgetStat
                      label={procOver ? "Over by" : "Remaining"}
                      paise={Math.abs(procRemaining!)}
                      tone={procOver ? "danger" : "success"}
                    />
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                    <div
                      className={cn("h-full rounded-full transition-all", procOver ? "bg-danger" : procPct >= 90 ? "bg-warning" : "bg-primary")}
                      style={{ width: `${Math.max(procurementBudgetPaise > 0 ? 2 : 0, procPct)}%` }}
                    />
                  </div>
                  {procOver && (
                    <p className="text-xs text-warning-foreground">
                      ⚠ Procurement spend exceeds its dedicated budget — allowed, worth a look.
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BudgetStat({
  label,
  paise,
  tone,
}: {
  label: string;
  paise: number;
  tone?: "danger" | "success";
}) {
  return (
    <div>
      <p className="text-[11px] text-foreground-subtle">{label}</p>
      <p
        className={cn(
          "font-mono text-sm font-medium tabular-nums",
          tone === "danger" && "text-danger-foreground",
          tone === "success" && "text-success-foreground",
        )}
      >
        <MoneyText paise={paise} compact />
      </p>
    </div>
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
