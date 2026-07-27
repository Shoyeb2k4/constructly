"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  return useQuery({ queryKey: procurementKeys.pos(filters), queryFn: () => procurementApi.listPurchaseOrders(filters) });
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

export function usePOMutations() {
  const qc = useQueryClient();
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: procurementKeys.all });
    qc.invalidateQueries({ queryKey: ["budget"] });
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

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
  });
  const duplicate = useMutation({
    mutationFn: (id: string) => procurementApi.duplicatePurchaseOrder(id),
    onSuccess: (po) => {
      invalidateAll();
      toast.success(`Duplicated as ${po.poNumber} (draft)`);
    },
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
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: procurementKeys.all });
    qc.invalidateQueries({ queryKey: ["budget"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

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
