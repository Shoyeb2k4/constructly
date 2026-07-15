import { isDemoMode } from "@/lib/env";
import { assembleDashboard } from "./assemble";
import { gatherDemoDashboard } from "./demo/gather";
import { gatherServerDashboard } from "./server/gather";
import type { DashboardSnapshot } from "./types";

export async function getDashboard(opts: {
  userId: string;
  isOwner: boolean;
}): Promise<DashboardSnapshot> {
  const raw = isDemoMode ? gatherDemoDashboard(opts) : await gatherServerDashboard();
  return assembleDashboard(raw);
}

export const dashboardKeys = {
  snapshot: (userId: string) => ["dashboard", userId] as const,
};
