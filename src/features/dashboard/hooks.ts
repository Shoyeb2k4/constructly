"use client";

import { useQuery } from "@tanstack/react-query";
import { getDashboard, dashboardKeys } from "./data";

export function useDashboard(userId: string, isOwner: boolean) {
  return useQuery({
    queryKey: dashboardKeys.snapshot(userId),
    queryFn: () => getDashboard({ userId, isOwner }),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
