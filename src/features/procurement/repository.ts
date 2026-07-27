import type {
  CreatePaymentInput,
  CreatePOInput,
  CreateVendorInput,
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
  listMaterials(): Promise<string[]>;
  listMembers(): Promise<{ id: string; fullName: string }[]>;
  addVendorDocument(
    vendorId: string,
    doc: { filename: string; sizeBytes: number; mimeType: string },
  ): Promise<VendorDetail>;
  removeVendorDocument(vendorId: string, docId: string): Promise<VendorDetail>;
  /** Material category presets (Settings-managed, company-wide). */
  listMaterialCategories(): Promise<string[]>;
  setMaterialCategories(categories: string[]): Promise<string[]>;

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
  deletePayment(id: string): Promise<void>;

  // Project-aware views
  getProjectProcurement(projectId: string): Promise<ProjectProcurement>;
  /** Outstanding aging (0–30 / 31–60 / 60+), optionally scoped to a project. */
  vendorAging(vendorId: string, projectId?: string): Promise<AgingBuckets>;
}
