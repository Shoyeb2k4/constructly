/** Vendors & procurement domain types (DTOs). Money is integer paise as `number`. */

export type VendorStatus = "ACTIVE" | "INACTIVE";
export type PurchaseOrderStatus = "DRAFT" | "SUBMITTED" | "APPROVED";

export interface Vendor {
  id: string;
  businessName: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  materialsSupplied: string[];
  paymentTerms: string | null;
  status: VendorStatus;
  notes: string | null;
  isFavorite: boolean;
  /** Lifetime purchases (sum of counted PO totals). */
  totalPurchasedPaise: number;
  poCount: number;
}

export interface POLineItem {
  id: string;
  material: string;
  quantity: number;
  unit: string;
  ratePaise: number;
  amountPaise: number;
  sortOrder: number;
}

export interface POLineItemInput {
  material: string;
  quantity: number;
  unit: string;
  ratePaise: number;
}

export interface PurchaseOrderListItem {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  purchaseDate: string;
  totalPaise: number;
  invoiceNumber: string | null;
  vendor: { id: string; name: string };
  project: { id: string; name: string; code: string };
  createdAt: string;
}

export interface PurchaseOrderDetail extends PurchaseOrderListItem {
  notes: string | null;
  lineItems: POLineItem[];
  createdByName: string;
  approvedByName: string | null;
  approvedAt: string | null;
  revisedFromId: string | null;
  revisedFromNumber: string | null;
}

export interface VendorDetail extends Vendor {
  purchaseHistory: PurchaseOrderListItem[];
}

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
}

export interface CreateVendorInput {
  businessName: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
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
  invoiceNumber?: string | null;
  notes?: string | null;
  lineItems: POLineItemInput[];
}
