"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { procurementApi, procurementKeys } from "./data";
import type {
  CreateMaterialInput,
  CreatePaymentInput,
  CreatePOInput,
  CreateVendorInput,
  PaymentFilters,
  MaterialFilters,
  POFilters,
  UpdateMaterialInput,
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

/* ── Material master ─────────────────────────────────────────────────── */

export function useMaterialMaster(filters: MaterialFilters = {}, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: procurementKeys.materialMaster(filters),
    queryFn: () => procurementApi.listMaterialMaster(filters),
    // Keep the current rows on screen while a search refetches, so the table
    // never blanks between keystrokes.
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });
}

/**
 * The materials a vendor NORMALLY supplies (active only) — what the PO picker
 * lists first. One query per vendor, shared by every line of an order.
 */
export function useVendorMaterials(vendorId: string, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: procurementKeys.vendorMaterials(vendorId),
    queryFn: () => procurementApi.listVendorMaterials(vendorId),
    enabled: !!vendorId && (opts.enabled ?? true),
  });
}

/**
 * Add one material to a vendor's usual list — the PO editor's optional "Also
 * add to …". Invalidates only what a mapping change affects: that vendor's
 * mappings, its detail, and the vendor lists that show its chips. Never the
 * Material Master (a mapping changes no material). Toasts are the caller's,
 * because the caller reports several of these as one outcome.
 */
export function useAddMaterialToVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { vendorId: string; materialId: string }) =>
      procurementApi.addMaterialToVendor(v.vendorId, v.materialId),
    onSuccess: (_list, v) => {
      qc.invalidateQueries({ queryKey: procurementKeys.vendorMaterials(v.vendorId) });
      qc.invalidateQueries({ queryKey: procurementKeys.vendor(v.vendorId) });
      qc.invalidateQueries({ queryKey: ["procurement", "vendors"] });
    },
  });
}

export function useMaterial(id: string) {
  return useQuery({
    queryKey: procurementKeys.material(id),
    queryFn: () => procurementApi.getMaterial(id),
    enabled: !!id,
  });
}

/**
 * The invalidation contract documented on `procurementKeys`, and nothing wider.
 * A material write cannot change a purchase order or a payment (their material
 * text is a frozen snapshot), so invalidating `procurementKeys.all` would only
 * queue refetches that cannot return anything new — the same mistake
 * `invalidateProcurementWrites` exists to avoid on the PO side.
 *
 * `materials` (the legacy name list older apps use) IS included, because it is
 * derived from the master — see ProcurementRepository.listMaterials.
 */
function invalidateMaterial(qc: ReturnType<typeof useQueryClient>, id?: string) {
  qc.invalidateQueries({ queryKey: ["procurement", "material-master"] });
  qc.invalidateQueries({ queryKey: procurementKeys.materials });
  if (id) qc.invalidateQueries({ queryKey: procurementKeys.material(id) });
  // Since Pass 7, views that LABEL materials by identity show the Material's
  // current name and archived state: vendor chips and material search, the
  // vendor ⇄ project rollups, and the dashboard's top materials. Those — and
  // still not POs or payments, whose snapshots a material write never touches.
  for (const queryKey of MATERIAL_LABEL_VIEWS) qc.invalidateQueries({ queryKey });
}

export const MATERIAL_LABEL_VIEWS = [
  ["procurement", "vendors"],
  ["procurement", "vendor"],
  ["procurement", "project"],
  ["dashboard"],
] as const;

/** Recorded names on unlinked PO lines — options for the PO material filter. */
export function useUnlinkedMaterialNames(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: procurementKeys.unlinkedMaterialNames,
    queryFn: () => procurementApi.listUnlinkedMaterialNames(),
    staleTime: 5 * 60_000,
    enabled: opts.enabled ?? true,
  });
}

/** Known domain errors from the material actions, in the user's words. */
function materialErrorMessage(e: unknown, fallback: string): string {
  const code = e instanceof Error ? e.message : "";
  switch (code) {
    case "MATERIAL_NAME_TAKEN":
      return "A material with this name already exists.";
    case "INVALID_UNIT":
      return "Select a valid unit.";
    case "INVALID_CATEGORY":
      return "Select a category from the list.";
    case "NOT_FOUND":
      return "That material no longer exists.";
    case "FORBIDDEN":
      return "You don't have permission to do that.";
    default:
      return fallback;
  }
}

export function useMaterialMutations() {
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: (input: CreateMaterialInput) => procurementApi.createMaterial(input),
    onSuccess: (m) => {
      invalidateMaterial(qc);
      toast.success("Material added", { description: m.name });
    },
    onError: (e) => toast.error(materialErrorMessage(e, "Couldn't add the material")),
  });

  const update = useMutation({
    mutationFn: (v: { id: string; patch: UpdateMaterialInput }) =>
      procurementApi.updateMaterial(v.id, v.patch),
    onSuccess: (m) => {
      invalidateMaterial(qc, m.id);
      toast.success("Saved");
    },
    onError: (e) => toast.error(materialErrorMessage(e, "Couldn't save the material")),
  });

  const setArchived = useMutation({
    mutationFn: (v: { id: string; archived: boolean }) =>
      procurementApi.setMaterialArchived(v.id, v.archived),
    onSuccess: (m, v) => {
      invalidateMaterial(qc, m.id);
      toast.success(v.archived ? "Material archived" : "Material restored", { description: m.name });
    },
    // A restore can legitimately fail because a live material has taken the name
    // in the meantime. That is the user's to resolve, so it is surfaced rather
    // than swallowed.
    onError: (e, v) =>
      toast.error(
        materialErrorMessage(
          e,
          v.archived ? "Couldn't archive the material" : "Couldn't restore the material",
        ),
      ),
  });

  return { create, update, setArchived };
}

/* ── Vendor mutations ────────────────────────────────────────────────── */

/** Known errors from a vendor save — including its material mappings. */
function vendorErrorMessage(e: unknown, fallback: string): string {
  const code = e instanceof Error ? e.message : "";
  switch (code) {
    case "NOT_FOUND":
      return "This vendor, or one of the selected materials, no longer exists.";
    case "MATERIAL_ARCHIVED":
      return "One of the selected materials has been archived. Remove it and save again.";
    case "FORBIDDEN":
      return "You don't have permission to do that.";
    default:
      return fallback;
  }
}

/**
 * What a vendor create/update can actually change, and nothing wider.
 *
 * Always: the vendor lists, and the transitional material-name list (the
 * vendor's legacy mirror feeds its filter options). On update, also that
 * vendor's detail and mappings, plus the purchase-order-side screens — the
 * vendor's name and status are rendered on PO rows, payments and project
 * procurement. Never the material master, members or categories: a vendor
 * write cannot change those.
 */
function invalidateVendorWrite(qc: ReturnType<typeof useQueryClient>, id?: string) {
  qc.invalidateQueries({ queryKey: ["procurement", "vendors"] });
  qc.invalidateQueries({ queryKey: procurementKeys.materials });
  if (!id) return;
  qc.invalidateQueries({ queryKey: procurementKeys.vendor(id) });
  qc.invalidateQueries({ queryKey: procurementKeys.vendorMaterials(id) });
  for (const key of [["procurement", "pos"], ["procurement", "po"], ["procurement", "payments"], ["procurement", "project"]]) {
    qc.invalidateQueries({ queryKey: key });
  }
}

export function useVendorMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: procurementKeys.all });

  const create = useMutation({
    mutationFn: (input: CreateVendorInput) => procurementApi.createVendor(input),
    onSuccess: (v) => {
      // A brand-new vendor is on no purchase order yet.
      invalidateVendorWrite(qc);
      toast.success("Vendor added", { description: v.businessName });
    },
    onError: (e) => toast.error(vendorErrorMessage(e, "Couldn't add the vendor")),
  });
  const update = useMutation({
    mutationFn: (v: { id: string; patch: UpdateVendorInput }) => procurementApi.updateVendor(v.id, v.patch),
    onSuccess: (vendor) => {
      invalidateVendorWrite(qc, vendor.id);
      toast.success("Saved");
    },
    onError: (e) => toast.error(vendorErrorMessage(e, "Couldn't save the vendor")),
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
    // A PO write can add or link an unlinked line — the filter's older-order names.
    ["procurement", "unlinked-material-names"],
  ];
  for (const queryKey of keys) qc.invalidateQueries({ queryKey });
  qc.invalidateQueries({ queryKey: ["budget"] });
  qc.invalidateQueries({ queryKey: ["dashboard"] });
  if (opts.projects) qc.invalidateQueries({ queryKey: ["projects"] });
}

/** Known errors from saving a purchase order, in the user's words. */
function poErrorMessage(e: unknown, fallback: string): string {
  const code = e instanceof Error ? e.message : "";
  switch (code) {
    case "MATERIAL_ARCHIVED":
      return "A material on this order has been archived. Choose an active material for that line.";
    case "NOT_FOUND":
      return "A material or vendor on this order no longer exists.";
    case "FORBIDDEN":
      return "You don't have permission to do that.";
    case "IMMUTABLE":
      return "This purchase order can no longer be edited.";
    default:
      return fallback;
  }
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
    onError: (e) => toast.error(poErrorMessage(e, "Couldn't create the purchase order")),
  });
  const update = useMutation({
    mutationFn: (v: { id: string; input: CreatePOInput }) => procurementApi.updatePurchaseOrder(v.id, v.input),
    onSuccess: (po) => {
      invalidateAll();
      qc.setQueryData(procurementKeys.po(po.id), po);
      toast.success("Saved");
    },
    // Previously absent: a failed edit said nothing at all.
    onError: (e) => toast.error(poErrorMessage(e, "Couldn't save the purchase order")),
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
  // There is deliberately no delete mutation here. The repository refuses to
  // remove a recorded vendor payment, so a hook whose success toast read
  // "Payment deleted" could only ever lie. See features/governance/delete-policy.ts.
  return { create };
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
