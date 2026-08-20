"use client";

/**
 * The contractors engaged on this project.
 *
 * This was a card buried in the middle of Overview, which badly understated it:
 * the project → contractor → labour type → attendance chain is the operational
 * spine of the product, and this is the link in it that a user configures. It is
 * now a section of its own.
 *
 * It deliberately does NOT restate the contractor's commercial position. Earned,
 * credited, due and advances are computed contractor-side and shown in the
 * Command Centre; duplicating them here would mean a second implementation of
 * figures that must agree. What it does instead is get you there in one click,
 * already scoped to this project.
 */

import Link from "next/link";
import { HardHat, ArrowRight, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/patterns/callout";
import { EmptyState } from "@/components/patterns/empty-state";
import { formatPaiseSmart } from "@/lib/money";
import type { ProjectDetail } from "../../types";

export function ContractorsTab({
  project,
  canEdit,
  onEdit,
}: {
  project: ProjectDetail;
  canEdit: boolean;
  onEdit: () => void;
}) {
  if (project.contractors.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No contractors on this project yet"
        description="Assign a contractor and the labour types they supply. Attendance can then be recorded against them — an agreement is optional."
        action={
          canEdit ? (
            <Button variant="primary" size="sm" onClick={onEdit}>
              <Plus />
              Assign contractors
            </Button>
          ) : undefined
        }
      />
    );
  }

  const unconfigured = project.contractors.filter((c) => c.labourRates.length === 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-foreground-muted">
          {project.contractors.length}{" "}
          {project.contractors.length === 1 ? "contractor" : "contractors"} engaged. Attendance is
          recorded against these, grouped by contractor.
        </p>
        <div className="flex items-center gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link href={`/labor?project=${project.id}`}>
              Record attendance
              <ArrowRight />
            </Link>
          </Button>
          {canEdit && (
            <Button variant="ghost" size="sm" onClick={onEdit}>
              Manage contractors
            </Button>
          )}
        </div>
      </div>

      {/* A contractor with no labour types cannot take attendance — say so once,
          at the top, rather than leaving the user to notice an empty row. */}
      {unconfigured.length > 0 && (
        <Callout tone="attention" title="Some contractors have no labour types configured">
          {unconfigured.map((c) => c.contractorName).join(", ")} — attendance cannot be recorded
          for {unconfigured.length === 1 ? "them" : "these"} until the labour types they supply are
          set, with the rate that applies on this project.
        </Callout>
      )}

      <ul className="space-y-3">
        {project.contractors.map((pc) => (
          <li
            key={pc.id}
            className="rounded-xl border border-border bg-surface p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <HardHat className="size-4 shrink-0 text-foreground-subtle" />
                <Link
                  href={`/labor/contractors/${pc.contractorId}`}
                  className="rounded-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {pc.contractorName}
                </Link>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {pc.contractRatePaise != null && (
                  <span className="whitespace-nowrap font-mono text-xs tabular-nums text-foreground-muted">
                    {formatPaiseSmart(pc.contractRatePaise)}
                    {pc.contractRateUnit === "sqft" ? " / sq.ft" : ""}
                  </span>
                )}
                {/* Straight into the contractor's commercial record — no
                    returning to the global list to search for them again. */}
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/labor/contractors/${pc.contractorId}`}>
                    Commercial
                    <ArrowRight />
                  </Link>
                </Button>
              </div>
            </div>

            {pc.labourRates.length === 0 ? (
              <p className="mt-2 text-xs text-foreground-muted">
                No labour types configured — attendance cannot be recorded yet.
              </p>
            ) : (
              <div className="mt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">
                  Labour supplied
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {pc.labourRates.map((r) => (
                    <span
                      key={r.id}
                      className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-xs text-foreground-muted"
                    >
                      {r.subcategoryName}
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {formatPaiseSmart(r.ratePaise)}/day
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
