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
});

/* Status is DELIBERATELY absent above: archiving and restoring are separate
   actions with their own permissions and audit events, so a lifecycle change can
   never ride along inside an ordinary detail edit. */

/**
 * A LABOUR ADVANCE: cash handed over to pre-pay future labour, netted off a
 * later settlement. Optionally scoped so the money keeps its commercial owner.
 *
 * An agreement scope requires its project — money for a specific agreement is
 * always money on that agreement's project.
 */
export const recordAdvanceSchema = z
  .object({
    contractorId: z.string().uuid(),
    date: isoDate,
    amountPaise: paise.min(1, "Amount is required"),
    notes: z.string().trim().max(500).optional().nullable(),
    projectId: z.string().uuid().optional().nullable(),
    contractId: z.string().uuid().optional().nullable(),
  })
  .refine((v) => !v.contractId || !!v.projectId, {
    message: "An agreement-scoped advance must also name its project",
    path: ["projectId"],
  });

export const reverseSettlementSchema = z.object({
  reason: z.string().trim().min(1, "A reversal reason is required").max(500),
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
