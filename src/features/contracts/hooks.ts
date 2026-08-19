"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { contractsApi, contractKeys } from "./data";
import { describeAgreementError } from "./agreement-actions";
import type {
  AddScopeItemInput,
  ContractFilters,
  ContractStatus,
  CreateContractInput,
  CreateMilestoneInput,
  MilestoneStatus,
  ProposeAmendmentInput,
  RecordContractPaymentInput,
  SetScopeRateInput,
  UpdateContractInput,
  UpdateMilestoneInput,
} from "./types";

/* ── Queries ─────────────────────────────────────────────────────────── */

export function useContracts(filters: ContractFilters = {}) {
  return useQuery({
    queryKey: contractKeys.list(filters),
    queryFn: () => contractsApi.listContracts(filters),
  });
}

export function useContract(id: string) {
  return useQuery({
    queryKey: contractKeys.detail(id),
    queryFn: () => contractsApi.getContract(id),
    enabled: !!id,
  });
}

export function useContractorProfile(contractorId: string) {
  return useQuery({
    queryKey: contractKeys.profile(contractorId),
    queryFn: () => contractsApi.getContractorProfile(contractorId),
    enabled: !!contractorId,
  });
}

/** The labour types one agreement covers. */
export function useScopeItems(contractId: string) {
  return useQuery({
    queryKey: contractKeys.scope(contractId),
    queryFn: () => contractsApi.listScopeItems(contractId),
    enabled: !!contractId,
  });
}

/** Rate revisions for one scope item — append-only, newest first. */
export function useRateRevisions(scopeItemId: string) {
  return useQuery({
    queryKey: contractKeys.rates(scopeItemId),
    queryFn: () => contractsApi.listRateRevisions(scopeItemId),
    enabled: !!scopeItemId,
  });
}

/** Audited commercial events across a contractor's agreements. */
export function useAgreementHistory(contractorId: string) {
  return useQuery({
    queryKey: contractKeys.history(contractorId),
    queryFn: () => contractsApi.listHistory(contractorId),
    enabled: !!contractorId,
  });
}

export function useProjectContracts(projectId: string) {
  return useQuery({
    queryKey: contractKeys.projectSummary(projectId),
    queryFn: () => contractsApi.projectContractsSummary(projectId),
    enabled: !!projectId,
  });
}

/* ── Mutations ───────────────────────────────────────────────────────── */

/**
 * MONEY-only refresh: every commercial figure, nothing structural.
 *
 * `contracts` covers the agreement list, detail, reconciliation and the
 * contractor profile the Command Centre's Overview / Agreements / Reconciliation
 * tabs read; `contractors` covers the settlement list and advance ledger shown
 * alongside them. `labor` is deliberately NOT invalidated — recording or
 * reversing a payment changes no attendance row and no labour type, so refetching
 * the attendance sheet would be pure waste.
 */
function useInvalidateCommercial() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: contractKeys.all });
    qc.invalidateQueries({ queryKey: ["contractors"] });
  };
}

/**
 * The above PLUS the labour module. Needed whenever an agreement's existence,
 * status or scope changes: an agreement's scope IS the set of labour types the
 * daily attendance sheet offers, and only OPEN agreements are offered at all —
 * so cancelling, settling or deleting one changes that sheet too.
 */
function useInvalidateAll() {
  const qc = useQueryClient();
  const commercial = useInvalidateCommercial();
  return () => {
    commercial();
    qc.invalidateQueries({ queryKey: ["labor"] });
  };
}

export function useCreateContract() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: CreateContractInput) => contractsApi.createContract(input),
    onSuccess: () => {
      invalidate();
      toast.success("Contract created");
    },
    onError: (e: unknown) =>
      toast.error(describeAgreementError(e, "Couldn't create the agreement.")),
  });
}

export function useUpdateContract() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateContractInput }) =>
      contractsApi.updateContract(id, patch),
    onSuccess: () => {
      invalidate();
      toast.success("Agreement updated");
    },
    onError: (e: unknown) =>
      toast.error(describeAgreementError(e, "Couldn't update the agreement.")),
  });
}

/**
 * PHYSICAL lifecycle only. CANCELLED is refused here by the server (USE_CANCEL) —
 * cancelling is its own authority and needs a reason, so it has its own hook.
 */
export function useSetContractStatus() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ContractStatus }) =>
      contractsApi.setContractStatus(id, status),
    onSuccess: () => {
      invalidate();
      toast.success("Agreement status updated");
    },
    onError: (e: unknown) =>
      toast.error(describeAgreementError(e, "Couldn't change the agreement status.")),
  });
}

/**
 * Cancel an agreement, preserving every payment, milestone and attendance row.
 * The path for an agreement with real history — as opposed to deleting one that
 * was created by mistake and never used.
 */
export function useCancelContract() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      contractsApi.cancelContract(id, reason),
    onSuccess: () => {
      invalidate();
      toast.success("Agreement cancelled");
    },
    onError: (e: unknown) =>
      toast.error(describeAgreementError(e, "Couldn't cancel the agreement.")),
  });
}

/** Only ever for a never-used agreement; the server refuses otherwise. */
export function useDeleteContract() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => contractsApi.deleteContract(id),
    onSuccess: () => {
      invalidate();
      toast.success("Agreement deleted");
    },
    onError: (e: unknown) =>
      toast.error(describeAgreementError(e, "Couldn't delete the agreement.")),
  });
}

export function useRecordContractPayment() {
  const invalidate = useInvalidateCommercial();
  return useMutation({
    mutationFn: (input: RecordContractPaymentInput) => contractsApi.recordContractPayment(input),
    onSuccess: () => {
      invalidate();
      toast.success("Payment recorded");
    },
    onError: (e: unknown) =>
      toast.error(describeAgreementError(e, "Couldn't record the payment.")),
  });
}

/* ── Agreement scope (the labour types an agreement covers) ──────────────── */

/**
 * Add a labour type to an agreement's scope, with its opening rate.
 *
 * The labour type comes from the company-wide taxonomy — this creates a
 * PRICING relationship, never a contractor-specific copy of the type itself.
 */
export function useAddScopeItem() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: AddScopeItemInput) => contractsApi.addScopeItem(input),
    onSuccess: invalidate,
    onError: (e: unknown) =>
      toast.error(describeAgreementError(e, "Couldn't add the labour type.")),
  });
}

/**
 * Take a labour type out of an agreement's scope. Refused once attendance has
 * been recorded against it (SCOPE_IN_USE) — those rows resolve their rate
 * through this item's history, and history has to stay resolvable.
 */
export function useRemoveScopeItem() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => contractsApi.removeScopeItem(id),
    onSuccess: invalidate,
    onError: (e: unknown) =>
      toast.error(describeAgreementError(e, "Couldn't remove the labour type.")),
  });
}

/** Revise a scope item's rate. APPENDS a revision; the old rate survives. */
export function useSetScopeRate() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: SetScopeRateInput) => contractsApi.setScopeRate(input),
    onSuccess: invalidate,
    onError: (e: unknown) => toast.error(describeAgreementError(e, "Couldn't set the rate.")),
  });
}

/**
 * Reverse a payment. Never a delete: the row, its reason and its audit entry
 * survive, and the money simply stops counting from this point on.
 */
export function useReverseContractPayment() {
  const invalidate = useInvalidateCommercial();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      contractsApi.reverseContractPayment(id, reason),
    onSuccess: () => {
      invalidate();
      toast.success("Payment reversed");
    },
    onError: (e: unknown) =>
      toast.error(describeAgreementError(e, "Couldn't reverse the payment.")),
  });
}

/* ── Milestones (earned value) ───────────────────────────────────────────── */

/**
 * A milestone is an earned-value checkpoint, never a payment bucket. Completing
 * one changes what the agreement has EARNED; it moves no money and allocates no
 * existing payment to it. Every one of these mutations therefore refreshes the
 * commercial views — reconciliation, the agreement rollups and the contractor's
 * lifetime position all read from earned value.
 *
 * `useInvalidateAll` rather than `useInvalidateCommercial`: a milestone can carry
 * an agreement into COMPLETED/SETTLED territory, and only OPEN agreements are
 * offered on the attendance sheet.
 */
export function useMilestones(contractId: string) {
  return useQuery({
    queryKey: contractKeys.milestones(contractId),
    queryFn: () => contractsApi.listMilestones(contractId),
    enabled: !!contractId,
  });
}

export function useCreateMilestone() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: CreateMilestoneInput) => contractsApi.createMilestone(input),
    onSuccess: () => {
      invalidate();
      toast.success("Milestone added");
    },
    onError: (e: unknown) => toast.error(describeAgreementError(e, "Couldn't add the milestone.")),
  });
}

/** The "6 slabs × ₹10,00,000" path. Values need not be equal. */
export function useCreateMilestonesBulk() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ contractId, inputs }: { contractId: string; inputs: CreateMilestoneInput[] }) =>
      contractsApi.createMilestonesBulk(contractId, inputs),
    onSuccess: (rows, vars) => {
      invalidate();
      toast.success(
        `${vars.inputs.length} milestone${vars.inputs.length === 1 ? "" : "s"} added`,
      );
    },
    onError: (e: unknown) => toast.error(describeAgreementError(e, "Couldn't add the milestones.")),
  });
}

export function useUpdateMilestone() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateMilestoneInput }) =>
      contractsApi.updateMilestone(id, patch),
    onSuccess: () => {
      invalidate();
      toast.success("Milestone updated");
    },
    onError: (e: unknown) =>
      toast.error(describeAgreementError(e, "Couldn't update the milestone.")),
  });
}

/**
 * PHYSICAL progress. Completing recognises earned value against the agreement's
 * authorised ceiling; reopening un-recognises it. Both are audited server-side.
 */
export function useSetMilestoneStatus() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({
      id,
      status,
      reason,
    }: {
      id: string;
      status: MilestoneStatus;
      reason?: string | null;
    }) => contractsApi.setMilestoneStatus(id, status, { reason: reason ?? null }),
    onSuccess: (_rows, vars) => {
      invalidate();
      toast.success(
        vars.status === "COMPLETED"
          ? "Milestone completed"
          : vars.status === "CANCELLED"
            ? "Milestone cancelled"
            : "Milestone updated",
      );
    },
    onError: (e: unknown) =>
      toast.error(describeAgreementError(e, "Couldn't change the milestone.")),
  });
}

/** Only ever for a milestone that never started and carries no payments. */
export function useDeleteMilestone() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => contractsApi.deleteMilestone(id),
    onSuccess: () => {
      invalidate();
      toast.success("Milestone deleted");
    },
    onError: (e: unknown) =>
      toast.error(describeAgreementError(e, "Couldn't delete the milestone.")),
  });
}

/** Presentation order only — never touches value, so no toast is needed. */
export function useReorderMilestones() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ contractId, orderedIds }: { contractId: string; orderedIds: string[] }) =>
      contractsApi.reorderMilestones(contractId, orderedIds),
    onSuccess: invalidate,
    onError: (e: unknown) =>
      toast.error(describeAgreementError(e, "Couldn't reorder the milestones.")),
  });
}

/* ── Amendments (the only path that moves the authorised value) ──────────── */

/**
 * Maker–checker: proposing needs `contracts.edit`, approving or rejecting needs
 * `contracts.amend_approve`. The server enforces the split; these hooks simply
 * call it.
 *
 * `useInvalidateAll` on every one of them. An approved amendment changes the
 * authorised value, which is the ceiling for milestone completion, the ceiling
 * for credit, and the denominator of milestone coverage — so agreements,
 * reconciliation, milestones and the contractor rollup all move at once.
 */
export function useAmendments(contractId: string) {
  return useQuery({
    queryKey: contractKeys.amendments(contractId),
    queryFn: () => contractsApi.listAmendments(contractId),
    enabled: !!contractId,
  });
}

export function useProposeAmendment() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: ProposeAmendmentInput) => contractsApi.proposeAmendment(input),
    onSuccess: () => {
      invalidate();
      toast.success("Amendment proposed");
    },
    onError: (e: unknown) =>
      toast.error(describeAgreementError(e, "Couldn't propose the amendment.")),
  });
}

export function useApproveAmendment() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => contractsApi.approveAmendment(id),
    onSuccess: () => {
      invalidate();
      toast.success("Amendment approved");
    },
    onError: (e: unknown) =>
      toast.error(describeAgreementError(e, "Couldn't approve the amendment.")),
  });
}

export function useRejectAmendment() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      contractsApi.rejectAmendment(id, reason),
    onSuccess: () => {
      invalidate();
      toast.success("Amendment rejected");
    },
    onError: (e: unknown) =>
      toast.error(describeAgreementError(e, "Couldn't reject the amendment.")),
  });
}
