/** Vendors & procurement domain types (DTOs). Money is integer paise as `number`. */

import type { GroupRollup, ProjectProcurementSummary } from "./calc";

export type VendorStatus = "ACTIVE" | "INACTIVE";
export type PurchaseOrderStatus = "DRAFT" | "SUBMITTED" | "APPROVED";
export type POPaymentStatus = "UNPAID" | "PARTIAL" | "PAID";
export type PaymentMode = "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE" | "CARD" | "OTHER";
export type VendorDocumentCategory = "DRAWING" | "PDF" | "PHOTO" | "CONTRACT" | "OTHER";

/**
 * A material a vendor is mapped to, as the vendor screens show it. Deliberately
 * slim — enough to label a chip and flag an archived one, nothing more.
 */
export interface VendorMaterialRef {
  id: string;
  name: string;
  /** false = the material was archived after being mapped. Still shown, so the
   *  mapping is never silently hidden; never offered as a new choice. */
  isActive: boolean;
}

export interface Vendor {
  id: string;
  businessName: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  /**
   * LEGACY mirror: the names of the vendor's mapped materials plus any names an
   * older app sent that match no Material. Kept only for older apps, which
   * still read and write it. Web filtering and search no longer use it (Pass 7
   * — they go through the VendorMaterial relation); no screen renders it — read
   * `materials`.
   */
  materialsSupplied: string[];
  /** Canonical: the vendor's VendorMaterial mappings, archived ones included. */
  materials: VendorMaterialRef[];
  /**
   * Names an OLDER app recorded for this vendor that match no Material Master
   * record, so they could not be mapped. Kept (never silently dropped) and shown
   * read-only until someone adds the material; they are carried forward on
   * every save. Transitional — goes when the legacy column does.
   */
  unlinkedMaterialNames: string[];
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

/**
 * A material master record, as application code sees it.
 *
 * Deliberately narrower than the Prisma row: `companyId`, `deletedById` and the
 * raw `deletedAt` timestamp are tenant/audit internals and never cross this
 * boundary. Deactivation is exposed as the single fact callers act on —
 * `isActive`.
 */
export interface Material {
  id: string;
  name: string;
  /** One of the company's material categories, or null. */
  category: string | null;
  /** Pre-selected as the PO line unit; one of UNITS. */
  defaultUnit: string | null;
  hsnCode: string | null;
  displayOrder: number;
  /** false = deactivated: hidden from new orders, but kept so history resolves. */
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMaterialInput {
  name: string;
  category?: string | null;
  defaultUnit?: string | null;
  hsnCode?: string | null;
}

export type UpdateMaterialInput = Partial<CreateMaterialInput> & { displayOrder?: number };

export interface MaterialFilters {
  search?: string;
  category?: string | "ALL";
  /** Include deactivated rows (master-data admin + historical lookups). */
  includeArchived?: boolean;
}

export interface POLineItem {
  id: string;
  material: string;
  /** Canonical material identity; null on every line written before the
   *  material master existed, and on legacy free-text lines. */
  materialId: string | null;
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
  /** Free text. IGNORED when `materialId` is supplied — the server snapshots the
   *  master record's name instead, so a client cannot desynchronise the two. */
  material: string;
  /** Optional canonical material. Omit for legacy free-text lines. */
  materialId?: string | null;
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
  /** Creator — present on list rows; used by the "Created by" filter. */
  createdBy?: { id: string; name: string } | null;
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
  /** Canonical: vendors with a VendorMaterial mapping to this Material. */
  materialId?: string | "ALL";
  /** COMPATIBILITY ONLY — the name filter older apps send. Ignored when
   *  `materialId` is set. Matches a mapped Material by normalized name, or an
   *  unmapped name an older app recorded. */
  material?: string | "ALL";
  favoritesOnly?: boolean;
}

/** PO list sort modes. NEWEST is the default. */
export type POSort =
  | "NEWEST"
  | "OLDEST"
  | "AMOUNT_DESC"
  | "AMOUNT_ASC"
  | "VENDOR_ASC"
  | "VENDOR_DESC"
  | "PROJECT_ASC"
  | "PO_NUMBER"
  | "STATUS"
  | "DELIVERY";

/** GST presence filter. */
export type POGstFilter = "ALL" | "WITH" | "WITHOUT";

export interface POFilters {
  search?: string;
  status?: PurchaseOrderStatus | "ALL";
  projectId?: string | "ALL";
  vendorId?: string | "ALL";
  /** Canonical: POs with a line LINKED to this Material (identity — survives
   *  renames and archiving; never matched by snapshot text). Wins over
   *  `material` when both are present. */
  materialId?: string | "ALL";
  /** RECORDED-NAME filter — the compatibility path for `?material=` bookmarks,
   *  older apps, and unlinked history: POs with a line whose snapshot text
   *  equals this after trim / collapse-whitespace / case-fold, linked or not.
   *  Ignored when `materialId` is set. */
  material?: string | "ALL";
  category?: string | "ALL";
  paymentStatus?: POPaymentStatus | "ALL";
  createdById?: string | "ALL";
  gst?: POGstFilter;
  /** Grand-total range, in paise (inclusive). */
  amountMinPaise?: number;
  amountMaxPaise?: number;
  dateFrom?: string;
  dateTo?: string;
  sort?: POSort;
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
  /** LEGACY free text. Accepted from older clients and written to the legacy
   *  column only — it never creates or maps a material. Ignored when
   *  `materialIds` is present. */
  materialsSupplied?: string[];
  /**
   * The vendor's supplied materials, as master ids. When present it REPLACES
   * the vendor's mappings in the same write as the vendor itself, so the record
   * and its materials cannot end up half-saved.
   */
  materialIds?: string[];
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
