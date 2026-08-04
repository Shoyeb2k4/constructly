import { formatPaise, formatPaiseCompact, formatPaiseSmart, type Paise } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Renders a paise value with tabular mono figures on a single line.
 * Default = smart full formatting (Indian numbering, exact paise, no bare `.00`,
 * never rounds). `compact` uses lakh/crore for genuinely dense tables and keeps
 * the full amount in a native tooltip so precision is never lost. `whole` keeps
 * the legacy rounded-to-rupee rendering for the few places that opt into it.
 */
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
    : whole
      ? formatPaise(paise, { whole })
      : formatPaiseSmart(paise);
  return (
    <span
      className={cn("font-mono tabular-nums whitespace-nowrap", className)}
      title={compact ? formatPaiseSmart(paise) : undefined}
    >
      {text}
    </span>
  );
}
