"use client";

/**
 * Label/amount pairs laid out so money can never collide with its label.
 *
 * The audit measured six real text-on-text collisions at 375px in the agreement
 * reconciliation block. The cause is worth stating precisely, because the
 * obvious culprit is the innocent one:
 *
 *   `MoneyText` never wraps and never rounds. That is DELIBERATE — an Indian-
 *   format amount broken across two lines, or silently rounded, is worse than
 *   useless on a financial screen. The money component was right.
 *
 *   The layout was wrong: a fixed `grid-cols-2` gave each pair ~160px on a
 *   phone, the amount could not shrink, and it overflowed its cell and printed
 *   on top of the next column's label.
 *
 * Two independent guards, so this cannot come back:
 *
 *   1. Column count starts at ONE and only rises when there is room.
 *   2. Within a pair the label takes `min-w-0` and may wrap or truncate, while
 *      the amount is `shrink-0`. Even if a future caller forces a narrow
 *      container, the label yields — the number never overflows.
 */

import * as React from "react";
import { MoneyText } from "@/components/patterns/money-text";
import { cn } from "@/lib/utils";

/** Responsive container for `FinancialLine` children. */
export function FinancialGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2 xl:grid-cols-3", className)}>
      {children}
    </div>
  );
}

export function FinancialLine({
  label,
  paise,
  tone,
  strong,
  note,
  className,
}: {
  label: string;
  paise: number;
  /** Semantic text colour. Meaning only — never "this is money, make it amber". */
  tone?: string;
  strong?: boolean;
  /** Secondary qualifier beside the label, e.g. "1/6" or "informational". */
  note?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-1.5", className)}>
      <span
        className={cn(
          // `min-w-0` lets the box shrink; `break-words` makes the TEXT inside
          // it actually reflow. Without the second one a long label or a note
          // like "1/6" overflows the shrunk box and paints over the amount —
          // measured at 8-11px of overlap before this was added.
          "min-w-0 break-words text-sm",
          strong ? "font-medium text-foreground" : "text-foreground-muted",
        )}
      >
        {label}
        {note && <span className="ml-1.5 whitespace-nowrap text-xs text-foreground-subtle">{note}</span>}
      </span>
      <MoneyText
        paise={paise}
        className={cn("shrink-0 font-mono tabular-nums", strong && "font-semibold", tone)}
      />
    </div>
  );
}
