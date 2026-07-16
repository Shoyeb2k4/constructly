import { z } from "zod";
import { toPaise } from "@/lib/money";
import type { CreateCategoryInput } from "./types";

export const categoryFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a color"),
  dailyRateRupees: z.coerce
    .number()
    .min(0, "Cannot be negative")
    .max(100000)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type CategoryFormValues = z.input<typeof categoryFormSchema>;

export function categoryFormToInput(
  v: z.output<typeof categoryFormSchema>,
): CreateCategoryInput {
  return {
    name: v.name,
    color: v.color,
    dailyRatePaise: v.dailyRateRupees != null ? toPaise(v.dailyRateRupees) : null,
  };
}

/** Labour attendance mutation payload — validated before entering the sync
 *  outbox and again on the server (/api/sync). quantity 0 deletes the row. */
export const labourAttendanceMutationSchema = z.object({
  projectId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  labourCategoryId: z.string().uuid(),
  quantityPresent: z.number().int().min(0).max(5000),
  notes: z.string().max(300).nullable().optional(),
});

export type LabourAttendanceMutation = z.infer<typeof labourAttendanceMutationSchema>;
