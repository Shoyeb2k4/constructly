import { isDemoMode } from "@/lib/env";
import { isNativeClient } from "@/lib/mobile/platform";
import { call } from "@/lib/mobile/rpc";
import type { ProjectSpend } from "./calc";
import { demoProjectSpend, demoSpendByProject } from "./spend";
import * as server from "./server-actions";

/**
 * Budget spend, per transport. Small enough to inline the switch rather than
 * grow a repository interface for two methods, but the priority is the same as
 * everywhere else: demo → fixtures, native → RPC, web → Server Actions.
 */
export const budgetApi = {
  projectSpend: (id: string): Promise<ProjectSpend> =>
    isDemoMode
      ? Promise.resolve(demoProjectSpend(id))
      : isNativeClient
        ? call<ProjectSpend>("budget", "projectSpend", [id])
        : server.projectSpend(id),
  spendByProject: (): Promise<Record<string, ProjectSpend>> =>
    isDemoMode
      ? Promise.resolve(Object.fromEntries(demoSpendByProject()))
      : isNativeClient
        ? call<Record<string, ProjectSpend>>("budget", "spendByProject")
        : server.spendByProject(),
};

export const budgetKeys = {
  all: ["budget"] as const,
  spend: (id: string) => ["budget", "spend", id] as const,
};
