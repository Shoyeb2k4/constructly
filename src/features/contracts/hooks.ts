"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { contractsApi, contractKeys } from "./data";
import type {
  AddScopeItemInput,
  ContractFilters,
  ContractStatus,
  CreateContractInput,
  RecordContractPaymentInput,
  SetScopeRateInput,
  UpdateContractInput,
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

function useInvalidateAll() {
  const qc = useQueryClient();
  // Contracts touch contractor profiles and the advance ledger sits alongside;
  // invalidate both families so every commercial view refreshes. `labor` too:
  // an agreement's scope IS the set of labour types the daily attendance sheet
  // offers, so changing scope must change that sheet without a reload.
  return () => {
    qc.invalidateQueries({ queryKey: contractKeys.all });
    qc.invalidateQueries({ queryKey: ["contractors"] });
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
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't create contract"),
  });
}

export function useUpdateContract() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateContractInput }) =>
      contractsApi.updateContract(id, patch),
    onSuccess: () => {
      invalidate();
      toast.success("Contract updated");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't update contract"),
  });
}

export function useSetContractStatus() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ContractStatus }) =>
      contractsApi.setContractStatus(id, status),
    onSuccess: () => {
      invalidate();
      toast.success("Contract updated");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't update contract"),
  });
}

export function useDeleteContract() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => contractsApi.deleteContract(id),
    onSuccess: () => {
      invalidate();
      toast.success("Contract deleted");
    },
    onError: () => toast.error("Couldn't delete contract"),
  });
}

export function useRecordContractPayment() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: RecordContractPaymentInput) => contractsApi.recordContractPayment(input),
    onSuccess: () => {
      invalidate();
      toast.success("Payment recorded");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't record payment"),
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
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't add the labour type"),
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
      toast.error(
        e instanceof Error && e.message.includes("SCOPE_IN_USE")
          ? "Labour has already been recorded against this type — it stays in scope so that history keeps its rate."
          : "Couldn't remove the labour type",
      ),
  });
}

/** Revise a scope item's rate. APPENDS a revision; the old rate survives. */
export function useSetScopeRate() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: SetScopeRateInput) => contractsApi.setScopeRate(input),
    onSuccess: invalidate,
    onError: (e: unknown) =>
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't set the rate"),
  });
}

export function useReverseContractPayment() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      contractsApi.reverseContractPayment(id, reason),
    onSuccess: () => {
      invalidate();
      toast.success("Payment reversed");
    },
    onError: () => toast.error("Couldn't reverse payment"),
  });
}
