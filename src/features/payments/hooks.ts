"use client";

import { useQuery } from "@tanstack/react-query";
import { getPayments, paymentsKeys } from "./data";
import type { PaymentsSnapshot, PaymentsVisibility } from "./types";

export function usePaymentsCentre(
  userId: string,
  isOwner: boolean,
  visibility: PaymentsVisibility,
  period: { from: string | null; to: string | null },
  initialData?: PaymentsSnapshot,
) {
  const { from, to } = period;
  return useQuery({
    queryKey: paymentsKeys.snapshot(userId, from, to),
    queryFn: () => getPayments({ userId, isOwner, visibility, from, to }),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    // Keeps the previous period's rows on screen while the next period loads,
    // so changing the period does not blank the table and re-flow the page.
    placeholderData: (prev) => prev,
    // Server-provided snapshot (production): render immediately, no
    // post-hydration fetch. Undefined in demo mode → the client fetches.
    initialData,
  });
}
