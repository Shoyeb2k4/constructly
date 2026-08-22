"use client";

import { useQuery } from "@tanstack/react-query";
import { runReport } from "./registry";
import type { ReportFilters } from "./types";

/**
 * Run one report.
 *
 * The period is part of the key, because it is a SERVER parameter for the
 * reports that take one — changing it must refetch, not re-filter rows the
 * browser already holds.
 */
export function useReport(
  id: string,
  filters: ReportFilters,
  ctx: { today: string; userId: string; isOwner: boolean; permissions: string[] },
) {
  return useQuery({
    queryKey: ["reports", id, filters, ctx.today, ctx.userId],
    queryFn: () =>
      runReport(id, filters, {
        today: ctx.today,
        userId: ctx.userId,
        isOwner: ctx.isOwner,
        permissions: ctx.permissions as Parameters<typeof runReport>[2]["permissions"],
      }),
    staleTime: 30_000,
    // Keeps the previous period's rows on screen while the next loads, so
    // changing the period does not blank the table and re-flow the page.
    placeholderData: (prev) => prev,
  });
}
