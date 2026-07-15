import type {
  CreatePOInput,
  CreateVendorInput,
  POFilters,
  PurchaseOrderDetail,
  PurchaseOrderListItem,
  UpdateVendorInput,
  Vendor,
  VendorDetail,
  VendorFilters,
  VendorStatus,
} from "./types";

/**
 * Vendors & procurement data contract. Demo (localStorage) and server
 * (Prisma + RLS) implementations satisfy it; the UI depends only here.
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
  deletePurchaseOrder(id: string): Promise<void>;
  pendingApprovalCount(): Promise<number>;
}
