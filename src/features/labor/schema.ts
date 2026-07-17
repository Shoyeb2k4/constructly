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
  quantityPresent: z.number().int().min(0).max(5000),
  notes: z.string().max(300).nullable().optional(),
});
export type LabourAttendanceMutation = z.infer<typeof labourAttendanceMutationSchema>;
