import type { SpendWeek } from "../../types";

/** Stacked weekly bars (labor + procurement). Pure CSS — responsive + theme-aware. */
export function SpendTrendChart({ data }: { data: SpendWeek[] }) {
  const max = Math.max(1, ...data.map((w) => w.laborPaise + w.procurementPaise));
  return (
    <div className="flex h-32 items-end gap-1.5">
      {data.map((w) => {
        const ph = (w.procurementPaise / max) * 100;
        const lh = (w.laborPaise / max) * 100;
        return (
          <div
            key={w.weekStart}
            className="flex flex-1 flex-col justify-end gap-px"
            title={`Week of ${w.weekStart}`}
          >
            <div className="rounded-t-sm bg-primary transition-all" style={{ height: `${ph}%` }} />
            <div
              className="rounded-b-sm bg-warning transition-all"
              style={{ height: `${lh}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}
