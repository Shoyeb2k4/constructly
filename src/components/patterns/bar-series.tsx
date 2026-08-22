/**
 * A bar series over time.
 *
 * Deliberately minimal, and deliberately the only chart primitive Reports gets.
 * A chart earns its place when SHAPE — a trend, a concentration, a gap — is
 * what the reader needs, and the two reports that use this are the two where a
 * table genuinely cannot show that. Anywhere else, a chart of four numbers is
 * decoration that pushes the real figures below the fold.
 *
 * Three rules it enforces:
 *
 *   THE CHART IS NEVER THE ONLY COPY. Every value it draws also appears in the
 *   table beneath it, so nothing is readable only by eye.
 *
 *   IT CARRIES ITS OWN WORDS. `role="img"` plus a real description means a
 *   screen-reader user is told what the shape says, not that there is a graphic.
 *
 *   IT DOES NOT SET ITS OWN WIDTH. Flexible bars, no fixed pixel canvas — a
 *   chart that needs 800px is a chart that breaks a phone.
 */

import { formatPaiseCompact } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface BarPoint {
  label: string;
  value: number;
}

export function BarSeries({
  points,
  kind,
  description,
  className,
}: {
  points: BarPoint[];
  /** Money is formatted in rupees; number is a plain count. */
  kind: "money" | "number";
  /** What the shape says, in words. Required — see rule two. */
  description: string;
  className?: string;
}) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const fmt = (v: number) => (kind === "money" ? formatPaiseCompact(v) : String(v));

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex h-32 items-end gap-1" role="img" aria-label={description}>
        {points.map((p) => (
          <div
            key={p.label}
            className="flex min-w-0 flex-1 flex-col justify-end"
            title={`${p.label}: ${fmt(p.value)}`}
          >
            <div
              className="rounded-t-sm bg-primary motion-safe:transition-all"
              style={{ height: `${(p.value / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      {/* Only the ends are labelled: a tick per bar is unreadable at 375px, and
          the exact figures live in the table rather than on the axis. */}
      <div className="mt-1.5 flex justify-between text-xs text-foreground-subtle">
        <span className="truncate">{points[0]?.label}</span>
        {points.length > 1 && (
          <span className="truncate">{points[points.length - 1]?.label}</span>
        )}
      </div>
    </div>
  );
}
