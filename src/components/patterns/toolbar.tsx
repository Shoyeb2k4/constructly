import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The operational control bar above a list or sheet.
 *
 * Every screen had grown its own: `flex flex-wrap items-center gap-2` here, a
 * second row of buttons there, and on Attendance the project, the date, the
 * calendar, copy-yesterday and two exports spread across three stacked rows —
 * which on a phone pushed the first data-entry field to y=610 of an 812px
 * screen.
 *
 * One shape, and one rule about ORDER: the controls that select WHAT you are
 * looking at come first and stay visible; the ones that act on it come last and
 * are free to collapse into a menu. Reporting exports are not an operator's
 * first concern at 7am and should never outrank the entry field.
 */
export function Toolbar({
  children,
  className,
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {children}
    </div>
  );
}

/**
 * A cluster of related controls. `grow` gives the cluster the leftover width —
 * use it for the primary selector so it stays readable as the bar narrows.
 */
export function ToolbarGroup({
  children,
  grow,
  className,
}: {
  children: React.ReactNode;
  grow?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("flex items-center gap-2", grow && "min-w-48 flex-1", className)}
    >
      {children}
    </div>
  );
}

/** Pushes everything after it to the trailing edge on wide screens. */
export function ToolbarSpacer() {
  return <div className="hidden flex-1 sm:block" aria-hidden="true" />;
}
