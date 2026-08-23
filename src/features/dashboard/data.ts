import { isDemoMode } from "@/lib/env";
import { isNativeClient } from "@/lib/mobile/platform";
import { call } from "@/lib/mobile/rpc";
import { assembleDashboard } from "./assemble";
import { gatherDemoDashboard } from "./demo/gather";
import { gatherServerDashboard } from "./server/gather";
import type { DashboardSnapshot, RawDashboardData } from "./types";

/**
 * Transport selection, matching every other feature's `data.ts`:
 *   demo mode  → in-browser fixtures
 *   native app → HTTP RPC (the mobile bundle stubs `server/gather`, so calling
 *                it there throws by design)
 *   web        → the server gather directly (unchanged production path)
 *
 * Only the RAW data crosses the wire. `assembleDashboard` is pure and runs on
 * the client either way, so the two platforms cannot diverge on how the
 * snapshot is derived — only on how the inputs were fetched.
 */
export async function getDashboard(opts: {
  userId: string;
  isOwner: boolean;
}): Promise<DashboardSnapshot> {
  const raw = isDemoMode
    ? gatherDemoDashboard(opts)
    : isNativeClient
      ? await call<RawDashboardData>("dashboard", "gather")
      : await gatherServerDashboard();
  return assembleDashboard(raw);
}

export const dashboardKeys = {
  snapshot: (userId: string) => ["dashboard", userId] as const,
};
