"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { contractorsApi, contractorKeys } from "./data";
import type {
  ContractorFilters,
  CreateContractorInput,
  CreateSettlementInput,
  RecordAdvanceInput,
  UpdateContractorInput,
} from "./types";
import type { SettlementFilters, SettlementPreviewInput } from "./repository";

/* ── Queries ─────────────────────────────────────────────────────────── */

export function useContractors(filters: ContractorFilters = {}) {
  return useQuery({
    queryKey: contractorKeys.list(filters),
    queryFn: () => contractorsApi.listContractors(filters),
  });
}
export function useContractor(id: string) {
  return useQuery({
    queryKey: contractorKeys.detail(id),
    queryFn: () => contractorsApi.getContractor(id),
    enabled: !!id,
  });
}
export function useContractorLedger(id: string) {
  return useQuery({
    queryKey: contractorKeys.ledger(id),
    queryFn: () => contractorsApi.getLedger(id),
    enabled: !!id,
  });
}
export function useSettlements(filters: SettlementFilters = {}) {
  return useQuery({
    queryKey: contractorKeys.settlements(filters),
    queryFn: () => contractorsApi.listSettlements(filters),
  });
}
export function useOutstandingAdvances() {
  return useQuery({
    queryKey: contractorKeys.outstanding,
    queryFn: () => contractorsApi.outstandingAdvances(),
  });
}
export function useContractorCostSummary() {
  return useQuery({
    queryKey: contractorKeys.costSummary,
    queryFn: () => contractorsApi.contractorCostSummary(),
  });
}

/* ── Mutations ───────────────────────────────────────────────────────── */

function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: contractorKeys.all });
}

export function useCreateContractor() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: CreateContractorInput) => contractorsApi.createContractor(input),
    onSuccess: () => {
      invalidate();
      toast.success("Contractor added");
    },
    onError: () => toast.error("Couldn't add contractor"),
  });
}

export function useUpdateContractor() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateContractorInput }) =>
      contractorsApi.updateContractor(id, patch),
    onSuccess: () => {
      invalidate();
      toast.success("Contractor updated");
    },
    onError: () => toast.error("Couldn't update contractor"),
  });
}

export function useRecordAdvance() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: RecordAdvanceInput) => contractorsApi.recordAdvance(input),
    onSuccess: () => {
      invalidate();
      toast.success("Advance recorded");
    },
    onError: () => toast.error("Couldn't record advance"),
  });
}

export function useCreateSettlement() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: CreateSettlementInput) => contractorsApi.createSettlement(input),
    onSuccess: () => {
      invalidate();
      toast.success("Settlement recorded");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't record settlement"),
  });
}

/** Imperative settlement preview (computed bill + clamped adjustment). */
export function usePreviewSettlement() {
  return useMutation({
    mutationFn: (input: SettlementPreviewInput) => contractorsApi.previewSettlement(input),
  });
}

/**
 * Reverse a settlement. Un-recognises the labour, restores each drawdown, and
 * turns the already-paid net cash into an unapplied advance — so the money the
 * contractor is holding never disappears from the ledger.
 */
export function useReverseSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      contractorsApi.reverseSettlement(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: contractorKeys.all });
      toast.success("Settlement reversed — its attendance is editable again");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't reverse settlement"),
  });
}
