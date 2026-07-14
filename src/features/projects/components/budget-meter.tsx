import { budgetPct } from "../format";
import { cn } from "@/lib/utils";

export function BudgetMeter({
  usedPaise,
  budgetPaise,
  className,
}: {
  usedPaise: number;
  budgetPaise: number;
  className?: string;
}) {
  const pct = budgetPct(usedPaise, budgetPaise);
  const over = budgetPaise > 0 && usedPaise > budgetPaise;
  const near = pct >= 90 && !over;
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-muted", className)}>
      <div
        className={cn(
          "h-full rounded-full transition-all duration-500",
          over ? "bg-danger" : near ? "bg-warning" : "bg-primary",
        )}
        style={{ width: `${budgetPaise > 0 ? Math.max(pct, 2) : 0}%` }}
      />
    </div>
  );
}
