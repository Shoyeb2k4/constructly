import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The single page-title system.
 *
 * `title` accepts a node so a record can sit its status badge on the same
 * baseline as its name rather than inventing a second heading block, and `meta`
 * gives context (project count, contact, agreement count) a place that is not
 * another paragraph. Both exist because the contractor record previously grew
 * its own bespoke identity card and ended up with three competing headers.
 *
 * Actions stay on one row and wrap as a group. Callers put the primary action
 * first and push rare or destructive ones into an overflow menu — a screen with
 * five equal-weight buttons has no hierarchy, and on a phone they collided.
 */
export function PageHeader({
  title,
  description,
  meta,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Compact context line under the title, e.g. contact · projects · agreements. */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {description && <p className="text-sm text-foreground-muted">{description}</p>}
        {meta && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground-muted">
            {meta}
          </div>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
