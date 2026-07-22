/** Vendors & procurement domain types (DTOs). Money is integer paise as `number`. */

import type { GroupRollup, ProjectProcurementSummary } from "./calc";

export type VendorStatus = "ACTIVE" | "INACTIVE";
export type PurchaseOrderStatus = "DRAFT" | "SUBMITTED" | "APPROVED";
export type POPaymentStatus = "UNPAID" | "PARTIAL" | "PAID";
export type PaymentMode = "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE" | "CARD" | "OTHER";
export type VendorDocumentCategory = "DRAWING" | "PDF" | "PHOTO" | "CONTRACT" | "OTHER";

export interface Vendor {
  id: string;
  businessName: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  materialsSupplied: string[];
  paymentTerms: string | null;
  status: VendorStatus;
  notes: string | null;
  isFavorite: boolean;
  /** Lifetime purchases (sum of counted PO grand totals). */
  totalPurchasedPaise: number;
  /** Derived: counted purchases − all payments. */
  outstandingPaise: number;
  poCount: number;
  projectsServed: number;
}

export interface POLineItem {
  id: string;
  material: string;
  category: string | null;
  quantity: number;
  unit: string;
  ratePaise: number;
  /** GST rate in basis points (1800 = 18%). */
  gstRateBps: number;
  gstPaise: number;
  /** Taxable amount = quantity × rate (ex-GST). */
  amountPaise: number;
  sortOrder: number;
}

export interface POLineItemInput {
  material: string;
  category?: string | null;
  quantity: number;
  unit: string;
  ratePaise: number;
  gstRateBps: number;
}

export interface PurchaseOrderListItem {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  purchaseDate: string;
  expectedDelivery: string | null;
  subtotalPaise: number;
  gstPaise: number;
  /** Grand total (incl. GST). */
  totalPaise: number;
  /** Σ payments linked to this PO. */
  paidPaise: number;
  paymentStatus: POPaymentStatus;
  invoiceNumber: string | null;
  vendor: { id: string; name: string };
  project: { id: string; name: string; code: string };
  createdAt: string;
}

export interface PurchaseOrderDetail extends PurchaseOrderListItem {
  notes: string | null;
  lineItems: POLineItem[];
  payments: VendorPaymentItem[];
  createdByName: string;
  approvedByName: string | null;
  approvedAt: string | null;
  revisedFromId: string | null;
  revisedFromNumber: string | null;
}

/* ── Payments ────────────────────────────────────────────────────────── */

export interface VendorPaymentItem {
  id: string;
  vendor: { id: string; name: string };
  project: { id: string; name: string; code: string };
  purchaseOrder: { id: string; poNumber: string } | null;
  amountPaise: number;
  paymentMode: PaymentMode;
  referenceNumber: string | null;
  date: string;
  remarks: string | null;
  createdByName: string;
  createdAt: string;
}

export interface CreatePaymentInput {
  vendorId: string;
  projectId: string;
  purchaseOrderId?: string | null;
  amountPaise: number;
  paymentMode: PaymentMode;
  referenceNumber?: string | null;
  date: string;
  remarks?: string | null;
  /** Client-generated idempotency key — a re-submit with the same value is deduped. */
  clientUuid?: string | null;
}

export interface PaymentFilters {
  vendorId?: string | "ALL";
  projectId?: string | "ALL";
  purchaseOrderId?: string;
  mode?: PaymentMode | "ALL";
  dateFrom?: string;
  dateTo?: string;
}

/* ── Vendor documents ────────────────────────────────────────────────── */

export interface VendorDocumentItem {
  id: string;
  category: VendorDocumentCategory;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  storagePath: string;
  createdAt: string;
}

/* ── Rollups (named views over pure calc shapes) ─────────────────────── */

/** Vendor profile → Projects tab row. */
export interface VendorProjectRow extends GroupRollup {
  project: { id: string; name: string; code: string };
}

/** Project → Procurement tab vendor row. */
export interface ProjectVendorRow extends GroupRollup {
  vendor: { id: string; name: string; status: VendorStatus };
}

export interface VendorDetail extends Vendor {
  purchaseHistory: PurchaseOrderListItem[];
  payments: VendorPaymentItem[];
  projects: VendorProjectRow[];
  documents: VendorDocumentItem[];
}

export type { ProjectProcurementSummary };

/** The full payload for a project's Procurement tab. */
export interface ProjectProcurement {
  summary: ProjectProcurementSummary;
  vendors: ProjectVendorRow[];
  purchaseOrders: PurchaseOrderListItem[];
  payments: VendorPaymentItem[];
}

/* ── Filters ─────────────────────────────────────────────────────────── */

export interface VendorFilters {
  search?: string;
  status?: VendorStatus | "ALL";
  material?: string | "ALL";
  favoritesOnly?: boolean;
}

export interface POFilters {
  search?: string;
  status?: PurchaseOrderStatus | "ALL";
  projectId?: string | "ALL";
  vendorId?: string | "ALL";
  material?: string | "ALL";
  category?: string | "ALL";
  paymentStatus?: POPaymentStatus | "ALL";
  dateFrom?: string;
  dateTo?: string;
}

/* ── Inputs ──────────────────────────────────────────────────────────── */

export interface CreateVendorInput {
  businessName: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  pan?: string | null;
  address?: string | null;
  materialsSupplied?: string[];
  paymentTerms?: string | null;
  notes?: string | null;
}

export type UpdateVendorInput = Partial<CreateVendorInput> & { status?: VendorStatus };

export interface CreatePOInput {
  vendorId: string;
  projectId: string;
  purchaseDate: string;
  expectedDelivery?: string | null;
  invoiceNumber?: string | null;
  notes?: string | null;
  lineItems: POLineItemInput[];
}
