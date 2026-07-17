import { MoneyText } from "@/components/patterns/money-text";
import { formatPaiseCompact } from "@/lib/money";

/** SVG donut splitting labor vs procurement. Theme-aware via stroke utilities. */
export function CostSplitDonut({
  laborPaise,
  procurementPaise,
}: {
  laborPaise: number;
  procurementPaise: number;
}) {
  const total = laborPaise + procurementPaise;
  const procPct = total > 0 ? procurementPaise / total : 0;
  const r = 42;
  const circ = 2 * Math.PI * r;
  const label = `Cost split: procurement ${formatPaiseCompact(procurementPaise)} (${Math.round(procPct * 100)}%), labour ${formatPaiseCompact(laborPaise)} (${Math.round((1 - procPct) * 100)}%). Total ${formatPaiseCompact(total)}.`;

  return (
    <div className="flex flex-col items-center">
      <div className="relative size-32">
        <svg viewBox="0 0 100 100" className="size-32 -rotate-90" role="img" aria-label={label}>
          <circle cx="50" cy="50" r={r} fill="none" className="stroke-warning" strokeWidth="12" />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            className="stroke-primary"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${procPct * circ} ${circ}`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] text-foreground-subtle">Total</span>
          <span className="text-sm font-semibold">
            <MoneyText paise={total} compact />
          </span>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-primary" />
          Procurement {Math.round(procPct * 100)}%
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-warning" />
          Labor {Math.round((1 - procPct) * 100)}%
        </span>
      </div>
    </div>
  );
}
