"use client";

import { useQuery } from "@tanstack/react-query";
import { budgetApi, budgetKeys } from "./data";
import { deriveBudget, type ProjectBudget } from "./calc";

export function useProjectSpend(projectId: string) {
  return useQuery({
    queryKey: budgetKeys.spend(projectId),
    queryFn: () => budgetApi.projectSpend(projectId),
  });
}

/** Derived budget for a project. Returns undefined until spend loads. */
export function useProjectBudget(
  projectId: string,
  budgetPaise: number,
): ProjectBudget | undefined {
  const { data } = useProjectSpend(projectId);
  return data ? deriveBudget(budgetPaise, data) : undefined;
}
