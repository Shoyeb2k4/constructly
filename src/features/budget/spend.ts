import { poCountsForBudget, type ProjectSpend } from "./calc";

/**
 * Demo spend readers — derive labor + procurement spend per project from the
 * local stores. Browser-only (guarded). The server path lives in
 * server-actions.ts. Both feed the same deriveBudget().
 */

const LABOUR_ATT = "constructly.demo.labourAttendance.v2";
const POS = "constructly.demo.pos.v1";
const SETTINGS = "constructly.demo.settings.v1";

export function demoApprovalRequired(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return JSON.parse(localStorage.getItem(SETTINGS) ?? "{}").poApprovalRequired ?? true;
  } catch {
    return true;
  }
}

function readStore<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as T[];
  } catch {
    return [];
  }
}

export function demoSpendByProject(): Map<string, ProjectSpend> {
  const approval = demoApprovalRequired();
  const map = new Map<string, ProjectSpend>();
  const get = (id: string) =>
    map.get(id) ?? map.set(id, { laborPaise: 0, procurementPaise: 0 }).get(id)!;

  // Labor cost = stored SNAPSHOT estimates (rate-at-record-time × headcount,
  // ADR-0022) — later rate edits never rewrite history.
  for (const a of readStore<{ projectId: string; estimatedCostPaise: number }>(LABOUR_ATT)) {
    get(a.projectId).laborPaise += a.estimatedCostPaise ?? 0;
  }
  for (const po of readStore<{ projectId: string; status: string; totalPaise: number }>(POS)) {
    if (poCountsForBudget(po.status as "DRAFT" | "SUBMITTED" | "APPROVED", approval)) {
      get(po.projectId).procurementPaise += po.totalPaise;
    }
  }
  return map;
}

export function demoProjectSpend(projectId: string): ProjectSpend {
  return demoSpendByProject().get(projectId) ?? { laborPaise: 0, procurementPaise: 0 };
}
