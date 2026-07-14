import { formatPaise, formatPaiseCompact, type Paise } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Renders a paise value with tabular mono figures. `compact` uses lakh/crore. */
export function MoneyText({
  paise,
  compact = false,
  whole = false,
  className,
}: {
  paise: Paise;
  compact?: boolean;
  whole?: boolean;
  className?: string;
}) {
  const text = compact
    ? formatPaiseCompact(paise)
    : formatPaise(paise, { whole });
  return (
    <span className={cn("font-mono tabular-nums", className)}>{text}</span>
  );
}
