import type { PurchaseOrderStatus } from "./types";

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
