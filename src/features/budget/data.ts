import { isDemoMode } from "@/lib/env";
import type { ProjectSpend } from "./calc";
import { demoProjectSpend, demoSpendByProject } from "./spend";
import * as server from "./server-actions";

export const budgetApi = {
  projectSpend: (id: string): Promise<ProjectSpend> =>
    isDemoMode ? Promise.resolve(demoProjectSpend(id)) : server.projectSpend(id),
  spendByProject: (): Promise<Record<string, ProjectSpend>> =>
    isDemoMode
      ? Promise.resolve(Object.fromEntries(demoSpendByProject()))
      : server.spendByProject(),
};

export const budgetKeys = {
  all: ["budget"] as const,
  spend: (id: string) => ["budget", "spend", id] as const,
};
