import { z } from "zod";
import { toPaise, toRupees } from "@/lib/money";
import type {
  CreatePaymentInput,
  CreatePOInput,
  CreateVendorInput,
  PaymentMode,
  PurchaseOrderDetail,
} from "./types";

const optionalStr = (max = 200) =>
  z.string().trim().max(max).optional().or(z.literal("")).transform((v) => (v ? v : undefined));

const phone = z
  .string()
  .trim()
  .regex(/^(\+91[-\s]?)?[6-9]\d{9}$/, "Enter a valid Indian mobile number")
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined));

const gstin = z
  .string()
  .trim()
  .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, "Invalid GSTIN")
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined));

const pan = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Invalid PAN")
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined));

export const vendorFormSchema = z.object({
  businessName: z.string().trim().min(2, "Name is too short").max(120),
  contactPerson: optionalStr(80),
  phone,
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  gstin,
  pan,
  address: optionalStr(240),
  materialsSupplied: z.array(z.string()).optional(),
  paymentTerms: optionalStr(80),
  notes: optionalStr(500),
});

export type VendorFormValues = z.input<typeof vendorFormSchema>;

export function vendorFormToInput(v: z.output<typeof vendorFormSchema>): CreateVendorInput {
  return {
    businessName: v.businessName,
    contactPerson: v.contactPerson ?? null,
    phone: v.phone ?? null,
    email: v.email ?? null,
    gstin: v.gstin ?? null,
    pan: v.pan ?? null,
    address: v.address ?? null,
    materialsSupplied: v.materialsSupplied ?? [],
    paymentTerms: v.paymentTerms ?? null,
    notes: v.notes ?? null,
  };
}

export const poLineItemSchema = z.object({
  material: z.string().trim().min(1, "Required").max(120),
  category: z.string().trim().max(60).optional().or(z.literal("")),
  quantity: z.coerce.number().positive("Must be > 0"),
  unit: z.string().trim().min(1, "Unit"),
  rateRupees: z.coerce.number().min(0, "Cannot be negative"),
  /** GST % as entered (0–28 typical, free entry allowed). */
  gstPercent: z.coerce.number().min(0, "Cannot be negative").max(100, "Too high"),
});

export const poFormSchema = z.object({
  vendorId: z.string().uuid("Pick a vendor"),
  projectId: z.string().uuid("Pick a project"),
  purchaseDate: z.string().min(1, "Pick a date"),
  expectedDelivery: z.string().optional().or(z.literal("")),
  invoiceNumber: optionalStr(60),
  notes: optionalStr(500),
  lineItems: z.array(poLineItemSchema).min(1, "Add at least one line item"),
});

export type POFormValues = z.input<typeof poFormSchema>;

export function poFormToInput(v: z.output<typeof poFormSchema>): CreatePOInput {
  return {
    vendorId: v.vendorId,
    projectId: v.projectId,
    purchaseDate: v.purchaseDate,
    expectedDelivery: v.expectedDelivery ? v.expectedDelivery : null,
    invoiceNumber: v.invoiceNumber ?? null,
    notes: v.notes ?? null,
    lineItems: v.lineItems.map((l) => ({
      material: l.material,
      category: l.category ? l.category : null,
      quantity: l.quantity,
      unit: l.unit,
      ratePaise: toPaise(l.rateRupees),
      gstRateBps: Math.round(l.gstPercent * 100),
    })),
  };
}

/** Pre-fill the editor form from an existing PO (edit mode). */
export function poDetailToForm(po: PurchaseOrderDetail): POFormValues {
  return {
    vendorId: po.vendor.id,
    projectId: po.project.id,
    purchaseDate: po.purchaseDate,
    expectedDelivery: po.expectedDelivery ?? "",
    invoiceNumber: po.invoiceNumber ?? "",
    notes: po.notes ?? "",
    lineItems: po.lineItems.map((l) => ({
      material: l.material,
      category: l.category ?? "",
      quantity: l.quantity,
      unit: l.unit,
      rateRupees: toRupees(l.ratePaise),
      gstPercent: l.gstRateBps / 100,
    })),
  };
}

/* ── Vendor payments ─────────────────────────────────────────────────── */

const PAYMENT_MODES = ["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "CARD", "OTHER"] as const;

export const paymentFormSchema = z.object({
  vendorId: z.string().uuid("Pick a vendor"),
  projectId: z.string().uuid("Pick a project"),
  /** Optional — advances / on-account / multi-PO settlements. */
  purchaseOrderId: z.string().optional().or(z.literal("")),
  amountRupees: z.coerce.number().positive("Must be > 0"),
  paymentMode: z.enum(PAYMENT_MODES),
  referenceNumber: optionalStr(80),
  date: z.string().min(1, "Pick a date"),
  remarks: optionalStr(500),
});

export type PaymentFormValues = z.input<typeof paymentFormSchema>;

export function paymentFormToInput(v: z.output<typeof paymentFormSchema>): CreatePaymentInput {
  return {
    vendorId: v.vendorId,
    projectId: v.projectId,
    purchaseOrderId: v.purchaseOrderId ? v.purchaseOrderId : null,
    amountPaise: toPaise(v.amountRupees),
    paymentMode: v.paymentMode as PaymentMode,
    referenceNumber: v.referenceNumber ?? null,
    date: v.date,
    remarks: v.remarks ?? null,
  };
}
