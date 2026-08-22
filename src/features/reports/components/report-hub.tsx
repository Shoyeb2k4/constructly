"use client";

/**
 * The report catalogue.
 *
 * This was a grid of nine equal cards with a decorative icon square, a noun
 * phrase for a name and a noun phrase for a description — nine tiles that all
 * looked the same and none of which said what question it answered. Scanning it
 * meant reading every card.
 *
 * So it is a grouped LIST now. The groups say what kind of question each
 * section answers, and every row leads with the question itself, because
 * "Cash movement" is only meaningful to someone who already knows what it
 * contains — and the person opening Reports usually does not.
 */

import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  FolderKanban,
  HardHat,
  ShoppingCart,
  Users,
} from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { REPORTS, reportsByCategory } from "../registry";
import { canViewReport } from "../report-meta";
import { useCan } from "@/features/rbac/permission-context";
import type { ReportCategory } from "../types";

const CATEGORY_ICON: Record<ReportCategory, React.ElementType> = {
  Payments: Banknote,
  Projects: FolderKanban,
  Contractors: Users,
  Labour: HardHat,
  Procurement: ShoppingCart,
};

export function ReportHub() {
  const can = useCan();
  // Only reports the user may view — financial reports are hidden without
  // reports.view_financial, and the server page guard enforces the same.
  const visible = REPORTS.filter((r) => canViewReport(can, r.id));
  const groups = reportsByCategory(visible);

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={FolderKanban}
        title="No reports available to you"
        description="Reports are grouped by permission. Ask an owner for access to the financial or operational report classes."
      />
    );
  }

  return (
    <div className="space-y-8">
      {groups.map((group) => {
        const Icon = CATEGORY_ICON[group.category];
        return (
          <section key={group.category} aria-labelledby={`reports-${group.category}`}>
            <div className="flex items-baseline gap-2">
              <Icon className="size-4 shrink-0 text-foreground-subtle" aria-hidden="true" />
              <h2 id={`reports-${group.category}`} className="text-sm font-semibold">
                {group.category}
              </h2>
              <p className="min-w-0 text-xs text-foreground-subtle">{group.blurb}</p>
            </div>

            <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {group.reports.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/reports/${r.id}`}
                    className={cn(
                      "group flex min-w-0 items-center gap-4 px-4 py-3.5 transition-colors",
                      "hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{r.name}</span>
                        {r.featured && <Badge variant="primary">Flagship</Badge>}
                      </span>
                      {/* The QUESTION, not a restatement of the name. */}
                      <span className="mt-0.5 block text-sm text-foreground-muted">
                        {r.question}
                      </span>
                    </span>
                    <ArrowRight
                      className="size-4 shrink-0 text-foreground-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
