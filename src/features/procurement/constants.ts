import type { PaymentMode, POPaymentStatus, PurchaseOrderStatus } from "./types";

/** Common units of measure for construction materials. */
export const UNITS = [
  "bag",
  "ton",
  "kg",
  "quintal",
  "cft",
  "brass",
  "sqft",
  "sqm",
  "rft",
  "nos",
  "litre",
  "roll",
  "box",
  "bundle",
] as const;

export const PO_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
};

export const PO_STATUSES: PurchaseOrderStatus[] = ["DRAFT", "SUBMITTED", "APPROVED"];

export const PO_PAYMENT_STATUS_LABEL: Record<POPaymentStatus, string> = {
  UNPAID: "Unpaid",
  PARTIAL: "Partially paid",
  PAID: "Paid",
};

export const PO_PAYMENT_STATUSES: POPaymentStatus[] = ["UNPAID", "PARTIAL", "PAID"];

/** Standard Indian GST slabs, in basis points. Free entry is also allowed. */
export const GST_PRESETS_BPS = [0, 500, 1200, 1800, 2800] as const;

export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  CASH: "Cash",
  UPI: "UPI",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  CARD: "Card",
  OTHER: "Other",
};

export const PAYMENT_MODES: PaymentMode[] = [
  "BANK_TRANSFER",
  "UPI",
  "CASH",
  "CHEQUE",
  "CARD",
  "OTHER",
];

/** Seeded material-category presets (Settings-managed thereafter). */
export const DEFAULT_MATERIAL_CATEGORIES = [
  "Cement",
  "Steel",
  "Sand & Aggregate",
  "Electrical",
  "Plumbing",
  "Paint",
  "Hardware",
  "Other",
] as const;
