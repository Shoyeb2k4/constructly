"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { procurementApi, procurementKeys } from "./data";
import type {
  CreatePaymentInput,
  CreatePOInput,
  CreateVendorInput,
  PaymentFilters,
  POFilters,
  UpdateVendorInput,
  VendorFilters,
  VendorStatus,
} from "./types";

/* ── Queries ─────────────────────────────────────────────────────────── */

export function useVendors(filters: VendorFilters = {}) {
  return useQuery({ queryKey: procurementKeys.vendors(filters), queryFn: () => procurementApi.listVendors(filters) });
}
export function useVendor(id: string) {
  return useQuery({ queryKey: procurementKeys.vendor(id), queryFn: () => procurementApi.getVendor(id) });
}
export function useMaterials() {
  return useQuery({ queryKey: procurementKeys.materials, queryFn: () => procurementApi.listMaterials(), staleTime: 5 * 60_000 });
}
export function useMembers() {
  return useQuery({ queryKey: procurementKeys.members, queryFn: () => procurementApi.listMembers(), staleTime: 5 * 60_000 });
}
export function usePurchaseOrders(filters: POFilters = {}) {
  return useQuery({
    queryKey: procurementKeys.pos(filters),
    queryFn: () => procurementApi.listPurchaseOrders(filters),
    // Keep the current rows visible while a background refetch runs (e.g. after
    // a duplicate/create invalidation or a filter change) so the list never
    // blanks — the "· updating…" hint reflects a real in-flight refetch that
    // always settles, never a wedged/empty state.
    placeholderData: keepPreviousData,
  });
}
export function usePurchaseOrder(id: string) {
  return useQuery({ queryKey: procurementKeys.po(id), queryFn: () => procurementApi.getPurchaseOrder(id) });
}
export function usePendingApprovalCount() {
  return useQuery({ queryKey: procurementKeys.pendingApprovals, queryFn: () => procurementApi.pendingApprovalCount() });
}
export function useMaterialCategories() {
  return useQuery({
    queryKey: procurementKeys.materialCategories,
    queryFn: () => procurementApi.listMaterialCategories(),
    staleTime: 5 * 60_000,
  });
}
export function usePayments(filters: PaymentFilters = {}) {
  return useQuery({ queryKey: procurementKeys.payments(filters), queryFn: () => procurementApi.listPayments(filters) });
}
export function useProjectProcurement(projectId: string) {
  return useQuery({
    queryKey: procurementKeys.projectProcurement(projectId),
    queryFn: () => procurementApi.getProjectProcurement(projectId),
  });
}
export function useVendorAging(vendorId: string, projectId?: string) {
  return useQuery({
    queryKey: procurementKeys.vendorAging(vendorId, projectId),
    queryFn: () => procurementApi.vendorAging(vendorId, projectId),
  });
}

/* ── Vendor mutations ────────────────────────────────────────────────── */

export function useVendorMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: procurementKeys.all });

  const create = useMutation({
    mutationFn: (input: CreateVendorInput) => procurementApi.createVendor(input),
    onSuccess: (v) => {
      invalidate();
      toast.success("Vendor added", { description: v.businessName });
    },
  });
  const update = useMutation({
    mutationFn: (v: { id: string; patch: UpdateVendorInput }) => procurementApi.updateVendor(v.id, v.patch),
    onSuccess: () => {
      invalidate();
      toast.success("Saved");
    },
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: VendorStatus }) => procurementApi.setVendorStatus(v.id, v.status),
    onSuccess: invalidate,
  });
  const toggleFavorite = useMutation({
    mutationFn: (id: string) => procurementApi.toggleVendorFavorite(id),
    onSuccess: invalidate,
  });
  const addDocument = useMutation({
    mutationFn: (v: { vendorId: string; doc: { filename: string; sizeBytes: number; mimeType: string } }) =>
      procurementApi.addVendorDocument(v.vendorId, v.doc),
    onSuccess: (detail) => {
      qc.setQueryData(procurementKeys.vendor(detail.id), detail);
      toast.success("Document added");
    },
  });
  const removeDocument = useMutation({
    mutationFn: (v: { vendorId: string; docId: string }) =>
      procurementApi.removeVendorDocument(v.vendorId, v.docId),
    onSuccess: (detail) => {
      qc.setQueryData(procurementKeys.vendor(detail.id), detail);
      toast.success("Document removed");
    },
  });

  return { create, update, setStatus, toggleFavorite, addDocument, removeDocument };
}

/* ── PO mutations (also invalidate budget + projects) ────────────────── */

/**
 * Invalidate exactly the procurement queries a PO/payment write can change —
 * deliberately NOT the static lists (materials, members, material-categories).
 * Those never change on a PO write, so force-refetching them only adds work:
 * with Next.js serializing Server Actions, their refetches QUEUE ahead of the
 * PO-list refetch and keep the list's "· updating…" indicator visible far longer
 * than the list fetch itself takes (the reported "stuck on Updating…"). Scoping
 * the invalidation lets the list refetch resolve promptly.
 */
function invalidateProcurementWrites(
  qc: ReturnType<typeof useQueryClient>,
  opts: { projects?: boolean } = {},
) {
  const keys = [
    ["procurement", "pos"],
    ["procurement", "po"],
    ["procurement", "payments"],
    ["procurement", "project"],
    ["procurement", "vendors"],
    ["procurement", "vendor"],
    ["procurement", "vendor-aging"],
    ["procurement", "pending-approvals"],
  ];
  for (const queryKey of keys) qc.invalidateQueries({ queryKey });
  qc.invalidateQueries({ queryKey: ["budget"] });
  qc.invalidateQueries({ queryKey: ["dashboard"] });
  if (opts.projects) qc.invalidateQueries({ queryKey: ["projects"] });
}

export function usePOMutations() {
  const qc = useQueryClient();
  const invalidateAll = () => invalidateProcurementWrites(qc, { projects: true });

  const create = useMutation({
    mutationFn: (input: CreatePOInput) => procurementApi.createPurchaseOrder(input),
    onSuccess: (po) => {
      invalidateAll();
      toast.success(`Purchase order ${po.poNumber} created`);
    },
    onError: () => toast.error("Couldn't create the purchase order"),
  });
  const update = useMutation({
    mutationFn: (v: { id: string; input: CreatePOInput }) => procurementApi.updatePurchaseOrder(v.id, v.input),
    onSuccess: (po) => {
      invalidateAll();
      qc.setQueryData(procurementKeys.po(po.id), po);
      toast.success("Saved");
    },
  });
  const submit = useMutation({
    mutationFn: (id: string) => procurementApi.submitPurchaseOrder(id),
    onSuccess: () => {
      invalidateAll();
      toast.success("Submitted for approval");
    },
  });
  const approve = useMutation({
    mutationFn: (id: string) => procurementApi.approvePurchaseOrder(id),
    onSuccess: () => {
      invalidateAll();
      toast.success("Purchase order approved");
    },
  });
  const revise = useMutation({
    mutationFn: (id: string) => procurementApi.revisePurchaseOrder(id),
    onSuccess: () => {
      invalidateAll();
      toast.success("Revision created as a new draft");
    },
    onError: () => toast.error("Couldn't create the revision"),
  });
  const duplicate = useMutation({
    mutationFn: (id: string) => procurementApi.duplicatePurchaseOrder(id),
    onSuccess: (po) => {
      invalidateAll();
      toast.success(`Duplicated as ${po.poNumber} (draft)`);
    },
    // Surface failures so the button re-enables and the flow never appears to
    // hang on error (the mutation always settles either way).
    onError: () => toast.error("Couldn't duplicate the purchase order"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => procurementApi.deletePurchaseOrder(id),
    onSuccess: () => {
      invalidateAll();
      toast.success("Purchase order deleted");
    },
    onError: () => toast.error("Couldn't delete this purchase order"),
  });

  return { create, update, submit, approve, revise, duplicate, remove };
}

/* ── Payment mutations (invalidate procurement + budget + dashboard) ─── */

export function usePaymentMutations() {
  const qc = useQueryClient();
  // A payment changes paid/outstanding + aggregates, but not project spend
  // (PO totals) — so no ["projects"] invalidation (parity with prior behaviour).
  const invalidateAll = () => invalidateProcurementWrites(qc);

  const create = useMutation({
    mutationFn: (input: CreatePaymentInput) => procurementApi.createPayment(input),
    onSuccess: () => {
      invalidateAll();
      toast.success("Payment recorded");
    },
    onError: () => toast.error("Couldn't record the payment"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => procurementApi.deletePayment(id),
    onSuccess: () => {
      invalidateAll();
      toast.success("Payment deleted");
    },
  });

  return { create, remove };
}

/* ── Material category mutations ─────────────────────────────────────── */

export function useMaterialCategoryMutations() {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (categories: string[]) => procurementApi.setMaterialCategories(categories),
    onSuccess: (next) => {
      qc.setQueryData(procurementKeys.materialCategories, next);
      toast.success("Material categories saved");
    },
  });
  return { save };
}
