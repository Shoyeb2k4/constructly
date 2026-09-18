import type {
  CreateMaterialInput,
  CreatePaymentInput,
  CreatePOInput,
  CreateVendorInput,
  Material,
  MaterialFilters,
  UpdateMaterialInput,
  PaymentFilters,
  POFilters,
  ProjectProcurement,
  PurchaseOrderDetail,
  PurchaseOrderListItem,
  UpdateVendorInput,
  Vendor,
  VendorDetail,
  VendorFilters,
  VendorPaymentItem,
  VendorStatus,
} from "./types";
import type { AgingBuckets } from "./calc";

/**
 * Vendors & procurement data contract. Demo (localStorage) and server
 * (Prisma + RLS) implementations satisfy it; the UI depends only here.
 * Online-only by design (ADR: financial integrity) — labour attendance is
 * the sole offline-first entity.
 */
export interface ProcurementRepository {
  // Vendors
  listVendors(filters?: VendorFilters): Promise<Vendor[]>;
  getVendor(id: string): Promise<VendorDetail | null>;
  createVendor(input: CreateVendorInput): Promise<Vendor>;
  updateVendor(id: string, patch: UpdateVendorInput): Promise<Vendor>;
  setVendorStatus(id: string, status: VendorStatus): Promise<Vendor>;
  toggleVendorFavorite(id: string): Promise<boolean>;
  /**
   * LEGACY — kept for OLDER APPS only, which build their "Material" filter
   * dropdowns from it and send the chosen name back as `material`. The union of
   * active Material names and the legacy `Vendor.materialsSupplied` strings.
   * The web app filters by `materialId` from the Material Master (Pass 7) and
   * no longer calls this. Remove once no shipped client does.
   */
  listMaterials(): Promise<string[]>;
  /**
   * Recorded names on UNLINKED PO lines (no materialId), one per normalized
   * spelling — the "older orders" options of the PO material filter, so history
   * written before materials were linked stays filterable.
   */
  listUnlinkedMaterialNames(): Promise<string[]>;
  listMembers(): Promise<{ id: string; fullName: string }[]>;
  addVendorDocument(
    vendorId: string,
    doc: { filename: string; sizeBytes: number; mimeType: string },
  ): Promise<VendorDetail>;
  removeVendorDocument(vendorId: string, docId: string): Promise<VendorDetail>;
  /** Material category presets (Settings-managed, company-wide). */
  listMaterialCategories(): Promise<string[]>;
  setMaterialCategories(categories: string[]): Promise<string[]>;

  // Material master — the canonical catalogue (see features/procurement/types).
  /** Active materials by default; `includeArchived` adds deactivated rows. */
  listMaterialMaster(filters?: MaterialFilters): Promise<Material[]>;
  /** Resolves archived materials too, so history and admin screens can read them. */
  getMaterial(id: string): Promise<Material | null>;
  createMaterial(input: CreateMaterialInput): Promise<Material>;
  updateMaterial(id: string, patch: UpdateMaterialInput): Promise<Material>;
  /** Deactivate / reactivate. One call, mirroring setVendorStatus — a material
   *  is never deleted, so this is the whole lifecycle. */
  setMaterialArchived(id: string, archived: boolean): Promise<Material>;

  // Vendor ↔ material: which materials a vendor NORMALLY supplies.
  // Eligibility only — never a constraint on what may be ordered.
  listVendorMaterials(vendorId: string): Promise<Material[]>;
  /** Replaces the whole mapping set for a vendor. Returns the new set. */
  setVendorMaterials(vendorId: string, materialIds: string[]): Promise<Material[]>;
  /** Idempotent add — re-adding an existing link succeeds and changes nothing. */
  addMaterialToVendor(vendorId: string, materialId: string): Promise<Material[]>;

  // Purchase orders
  listPurchaseOrders(filters?: POFilters): Promise<PurchaseOrderListItem[]>;
  getPurchaseOrder(id: string): Promise<PurchaseOrderDetail | null>;
  createPurchaseOrder(input: CreatePOInput): Promise<PurchaseOrderDetail>;
  /** Only DRAFT POs are editable (approved POs are immutable — use revise). */
  updatePurchaseOrder(id: string, input: CreatePOInput): Promise<PurchaseOrderDetail>;
  submitPurchaseOrder(id: string): Promise<PurchaseOrderListItem>;
  approvePurchaseOrder(id: string): Promise<PurchaseOrderListItem>;
  /** Clone an approved PO to a new linked draft (audit trail). */
  revisePurchaseOrder(id: string): Promise<PurchaseOrderDetail>;
  /** Clone ANY PO to a fresh unlinked draft dated today (repeat purchases). */
  duplicatePurchaseOrder(id: string): Promise<PurchaseOrderDetail>;
  /** Permanently delete a PO (owner-only, any status; cascades line items). */
  deletePurchaseOrder(id: string): Promise<void>;
  pendingApprovalCount(): Promise<number>;

  // Payments (PO link optional — advances / on-account / settlements)
  listPayments(filters?: PaymentFilters): Promise<VendorPaymentItem[]>;
  createPayment(input: CreatePaymentInput): Promise<VendorPaymentItem>;
  /** Owner-only: payments are financial records; removal is audited. */
  /**
   * Always refuses with VENDOR_PAYMENT_IMMUTABLE. Kept in the contract so a
   * caller gets the explanation rather than a missing method — vendor payments
   * have no reversal yet, so the only safe answer is not to destroy one.
   */
  deletePayment(id: string): Promise<never>;

  // Project-aware views
  getProjectProcurement(projectId: string): Promise<ProjectProcurement>;
  /** Outstanding aging (0–30 / 31–60 / 60+), optionally scoped to a project. */
  vendorAging(vendorId: string, projectId?: string): Promise<AgingBuckets>;
}
