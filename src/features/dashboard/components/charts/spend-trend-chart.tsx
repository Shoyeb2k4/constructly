import { formatPaiseCompact } from "@/lib/money";
import type { SpendWeek } from "../../types";

/** Stacked weekly bars (labor + procurement). Pure CSS — responsive + theme-aware. */
export function SpendTrendChart({ data }: { data: SpendWeek[] }) {
  const max = Math.max(1, ...data.map((w) => w.laborPaise + w.procurementPaise));
  const totalProc = data.reduce((s, w) => s + w.procurementPaise, 0);
  const totalLabor = data.reduce((s, w) => s + w.laborPaise, 0);
  const label = `Weekly spend over the last ${data.length} weeks: procurement ${formatPaiseCompact(totalProc)}, labour ${formatPaiseCompact(totalLabor)}.`;

  return (
    <div className="flex h-32 items-end gap-1.5" role="img" aria-label={label}>
      {data.map((w) => {
        const ph = (w.procurementPaise / max) * 100;
        const lh = (w.laborPaise / max) * 100;
        return (
          <div
            key={w.weekStart}
            className="flex flex-1 flex-col justify-end gap-px"
            title={`Week of ${w.weekStart}: procurement ${formatPaiseCompact(w.procurementPaise)}, labour ${formatPaiseCompact(w.laborPaise)}`}
          >
            <div className="motion-safe:transition-all rounded-t-sm bg-primary" style={{ height: `${ph}%` }} />
            <div
              className="motion-safe:transition-all rounded-b-sm bg-warning"
              style={{ height: `${lh}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}
