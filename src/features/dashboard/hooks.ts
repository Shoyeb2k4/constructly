"use client";

import { useQuery } from "@tanstack/react-query";
import { getDashboard, dashboardKeys } from "./data";
import type { DashboardSnapshot } from "./types";

export function useDashboard(
  userId: string,
  isOwner: boolean,
  initialData?: DashboardSnapshot,
) {
  return useQuery({
    queryKey: dashboardKeys.snapshot(userId),
    queryFn: () => getDashboard({ userId, isOwner }),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    // Server-provided snapshot (production): render immediately, skip the
    // post-hydration fetch. Undefined in demo mode → client fetches as before.
    initialData,
  });
}
