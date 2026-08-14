import { z } from "zod";
import { toPaise } from "@/lib/money";
import type { CreateSubcategoryInput } from "./types";

export const categoryFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(40),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});
export type CategoryFormValues = z.input<typeof categoryFormSchema>;

export const subcategoryFormSchema = z.object({
  categoryId: z.string().min(1, "Pick a category"),
  name: z.string().trim().min(1, "Name is required").max(60),
  dailyRateRupees: z.coerce
    .number()
    .min(0, "Cannot be negative")
    .max(100000)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});
export type SubcategoryFormValues = z.input<typeof subcategoryFormSchema>;

export function subcategoryFormToInput(
  v: z.output<typeof subcategoryFormSchema>,
): CreateSubcategoryInput {
  return {
    categoryId: v.categoryId,
    name: v.name,
    dailyRatePaise: v.dailyRateRupees != null ? toPaise(v.dailyRateRupees) : null,
  };
}

/** Labour attendance mutation payload — validated before entering the sync
 *  outbox and again on the server (/api/sync). quantity 0 deletes the row. */
export const labourAttendanceMutationSchema = z.object({
  projectId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  labourSubcategoryId: z.string().uuid(),
  /** Half-days allowed: any 0.5 increment (0, 0.5, 1, 1.5, …). */
  quantityPresent: z
    .number()
    .min(0)
    .max(5000)
    .refine((v) => Number.isInteger(v * 2), "Use 0.5 steps (half day)"),
  notes: z.string().max(300).nullable().optional(),
  /** Optional contractor this labour is attributed to (for weekly settlement). */
  contractorId: z.string().uuid().nullable().optional(),
  /**
   * The agreement this labour belongs to. Part of the row IDENTITY, so it must
   * travel with every queued mutation — an offline edit that dropped it would
   * come back online and overwrite a different agreement's row.
   *
   * Absent/null is a legitimate value (attendance-only), never a placeholder for
   * "figure it out on the server": an agreement is never inferred.
   */
  contractId: z.string().uuid().nullable().optional(),
});
export type LabourAttendanceMutation = z.infer<typeof labourAttendanceMutationSchema>;
