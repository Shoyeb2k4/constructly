"use client";

import { useQuery } from "@tanstack/react-query";
import { getReport } from "./registry";
import type { ReportFilters } from "./types";

export function useReport(id: string, filters: ReportFilters) {
  return useQuery({
    queryKey: ["reports", id, filters],
    queryFn: () => {
      const def = getReport(id);
      if (!def) throw new Error("UNKNOWN_REPORT");
      return def.run(filters);
    },
    enabled: !!getReport(id),
  });
}
