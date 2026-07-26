import { z } from "zod";

const paise = z.number().int().min(0);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const createContractorSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z.string().trim().max(20).optional().nullable(),
  openingAdvancePaise: paise.optional(),
});

export const updateContractorSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(20).optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export const recordAdvanceSchema = z.object({
  contractorId: z.string().uuid(),
  date: isoDate,
  amountPaise: paise.min(1, "Amount is required"),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const createSettlementSchema = z
  .object({
    contractorId: z.string().uuid(),
    projectId: z.string().uuid(),
    periodStart: isoDate,
    periodEnd: isoDate,
    advanceAdjustmentPaise: paise,
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .refine((v) => v.periodStart <= v.periodEnd, {
    message: "Period start must be on or before the end",
    path: ["periodEnd"],
  });
