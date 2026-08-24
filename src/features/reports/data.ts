import { isDemoMode } from "@/lib/env";
import { isNativeClient } from "@/lib/mobile/platform";
import { call } from "@/lib/mobile/rpc";
import * as server from "./server/actions";
import type { ExportDecision } from "./authorization";

/**
 * Transport for the reports layer's authorization gates.
 *
 * Reports have no repository of their own — a report is composed on the client
 * from other modules' already-gated data APIs. The only thing that has to cross
 * to the server is the export decision, and until now it had no native path at
 * all: `server/actions.ts` is replaced by a throwing stub in the mobile bundle,
 * so on a phone every export attempt failed, and the caller reported that as a
 * permission denial. Report export was impossible on Android for every user,
 * including an Owner.
 *
 * Priority matches every other feature: demo → fixtures, native → RPC, web →
 * Server Action.
 */

/**
 * Demo builds never reach a backend. The demo user is the seeded owner, so the
 * honest answer is the one the server would give: allowed.
 */
const demoDecision: ExportDecision = { allowed: true };

export async function authorizeReportExport(reportId: string): Promise<ExportDecision> {
  if (isDemoMode) return demoDecision;
  if (isNativeClient) return call<ExportDecision>("reports", "authorizeExport", [reportId]);
  return server.authorizeReportExport(reportId);
}
