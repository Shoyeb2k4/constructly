"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { contractorsApi, contractorKeys } from "./data";
import { contractKeys } from "@/features/contracts/data";
import { describeContractorError } from "./lifecycle";
import { describeRescopeBlocker } from "./advance-rescope";
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
  return () => {
    qc.invalidateQueries({ queryKey: contractorKeys.all });
    // A settlement decides which attendance is SETTLED, and settled attendance
    // is what the agreement Command Centre reads for agreement credit and for
    // the unattributed-labour position. That surface lives under the contracts
    // key, so invalidating only the contractor key leaves it stale until the
    // user reloads — showing a figure the settlement has already changed.
    qc.invalidateQueries({ queryKey: contractKeys.all });
  };
}

/**
 * Create a contractor.
 *
 * A look-alike comes back as `{ duplicates }` rather than a thrown code — two
 * genuinely different crews can share a name, so the caller shows the matches
 * and lets the user decide, then retries with `allowDuplicate`. Nothing is
 * created on the first call in that case.
 */
export function useCreateContractor() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: CreateContractorInput & { allowDuplicate?: boolean }) =>
      contractorsApi.createContractor(input),
    onSuccess: (res) => {
      if ("duplicates" in res) return; // a question, not a result
      invalidate();
      toast.success("Contractor added");
    },
    onError: (e: unknown) => toast.error(describeContractorError(e, "Couldn't add the contractor.")),
  });
}

/**
 * Archive (deactivate). Keeps every agreement, settlement, payment and
 * attendance row; stops new business only.
 */
export function useArchiveContractor() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => contractorsApi.archiveContractor(id),
    onSuccess: () => {
      invalidate();
      toast.success("Contractor archived");
    },
    onError: (e: unknown) =>
      toast.error(describeContractorError(e, "Couldn't archive the contractor.")),
  });
}

export function useRestoreContractor() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => contractorsApi.restoreContractor(id),
    onSuccess: () => {
      invalidate();
      toast.success("Contractor restored");
    },
    onError: (e: unknown) =>
      toast.error(describeContractorError(e, "Couldn't restore the contractor.")),
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
    onError: (e: unknown) =>
      toast.error(describeContractorError(e, "Couldn't update the contractor.")),
  });
}

/* ── Advance re-scope ───────────────────────────────────────────────────── */

export function useAdvanceRescopePreview(input: {
  contractorId: string;
  advanceId: string | null;
  target: { projectId: string | null; contractId: string | null };
  transferPaise: number;
}) {
  return useQuery({
    queryKey: [
      ...contractorKeys.all,
      "rescope-preview",
      input.advanceId,
      input.target.projectId,
      input.target.contractId,
      input.transferPaise,
    ],
    queryFn: () =>
      contractorsApi.previewAdvanceRescope({
        contractorId: input.contractorId,
        advanceId: input.advanceId!,
        target: input.target,
        transferPaise: input.transferPaise,
      }),
    enabled: !!input.advanceId && input.transferPaise > 0,
  });
}

export function useRescopeAdvance() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: {
      contractorId: string;
      advanceId: string;
      target: { projectId: string | null; contractId: string | null };
      transferPaise: number;
      reason: string;
    }) => contractorsApi.rescopeAdvance(input),
    // A refusal is a decision, not a transient failure.
    retry: false,
    onSuccess: (res) => {
      invalidate();
      if ("blockers" in res) return; // the sheet renders the reason
      toast.success(`Re-scoped to ${res.toLabel} — no cash moved`);
    },
    onError: (e: unknown) =>
      toast.error(describeContractorError(e, "Couldn't re-scope that advance.")),
  });
}

export function useReverseAdvanceRescope() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: { transferId: string; reason: string }) =>
      contractorsApi.reverseAdvanceRescope(input),
    retry: false,
    onSuccess: (res) => {
      invalidate();
      if ("blockers" in res) {
        toast.error(describeRescopeBlocker(res.blockers[0]));
        return;
      }
      toast.success("Re-scope reversed");
    },
    onError: (e: unknown) =>
      toast.error(describeContractorError(e, "Couldn't reverse that re-scope.")),
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
    onError: (e: unknown) =>
      toast.error(describeContractorError(e, "Couldn't record the advance.")),
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
      toast.error(describeContractorError(e, "Couldn't record the settlement.")),
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
      // Reversal un-settles the period, which moves labour back out of both
      // settled buckets — the agreement's credit and the unattributed figure.
      qc.invalidateQueries({ queryKey: contractKeys.all });
      toast.success("Settlement reversed — its attendance is editable again");
    },
    onError: (e: unknown) =>
      toast.error(describeContractorError(e, "Couldn't reverse the settlement.")),
  });
}
