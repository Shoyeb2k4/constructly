/**
 * Budget derivation — the single source of truth (ADR-0018). Combines labor
 * cost (Module 2) and procurement cost (Module 3) against the project budget.
 * Used identically by the project Overview, projects list meters, and the
 * dashboard. Pure and unit-tested.
 */

export interface ProjectSpend {
  laborPaise: number;
  procurementPaise: number;
}

export interface ProjectBudget {
  budgetPaise: number;
  laborPaise: number;
  procurementPaise: number;
  usedPaise: number;
  remainingPaise: number;
  utilizationPct: number;
  overBudget: boolean;
}

export function deriveBudget(budgetPaise: number, spend: ProjectSpend): ProjectBudget {
  const usedPaise = spend.laborPaise + spend.procurementPaise;
  return {
    budgetPaise,
    laborPaise: spend.laborPaise,
    procurementPaise: spend.procurementPaise,
    usedPaise,
    remainingPaise: budgetPaise - usedPaise,
    utilizationPct: budgetPaise > 0 ? Math.round((usedPaise / budgetPaise) * 100) : 0,
    overBudget: budgetPaise > 0 && usedPaise > budgetPaise,
  };
}

/**
 * Which PO statuses count toward budget, given the company's approval setting.
 * Approval ON → only APPROVED. Approval OFF → everything except DRAFT.
 */
export function poCountsForBudget(
  status: "DRAFT" | "SUBMITTED" | "APPROVED",
  approvalRequired: boolean,
): boolean {
  return approvalRequired ? status === "APPROVED" : status !== "DRAFT";
}
