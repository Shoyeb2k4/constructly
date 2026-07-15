import { z } from "zod";
import { toPaise } from "@/lib/money";
import type { CreatePOInput, CreateVendorInput } from "./types";

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

export const vendorFormSchema = z.object({
  businessName: z.string().trim().min(2, "Name is too short").max(120),
  contactPerson: optionalStr(80),
  phone,
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  gstin,
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
    address: v.address ?? null,
    materialsSupplied: v.materialsSupplied ?? [],
    paymentTerms: v.paymentTerms ?? null,
    notes: v.notes ?? null,
  };
}

export const poLineItemSchema = z.object({
  material: z.string().trim().min(1, "Required").max(120),
  quantity: z.coerce.number().positive("Must be > 0"),
  unit: z.string().trim().min(1, "Unit"),
  rateRupees: z.coerce.number().min(0, "Cannot be negative"),
});

export const poFormSchema = z.object({
  vendorId: z.string().uuid("Pick a vendor"),
  projectId: z.string().uuid("Pick a project"),
  purchaseDate: z.string().min(1, "Pick a date"),
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
    invoiceNumber: v.invoiceNumber ?? null,
    notes: v.notes ?? null,
    lineItems: v.lineItems.map((l) => ({
      material: l.material,
      quantity: l.quantity,
      unit: l.unit,
      ratePaise: toPaise(l.rateRupees),
    })),
  };
}
