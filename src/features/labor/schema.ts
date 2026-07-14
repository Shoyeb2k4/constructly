import { z } from "zod";
import { toPaise } from "@/lib/money";
import type { CreateLaborerInput } from "./types";

const phone = z
  .string()
  .trim()
  .regex(/^(\+91[-\s]?)?[6-9]\d{9}$/, "Enter a valid Indian mobile number")
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined));

export const laborerFormSchema = z.object({
  fullName: z.string().trim().min(2, "Name is too short").max(80),
  phone,
  trade: z.string().trim().min(1, "Pick a trade").max(40),
  dailyWageRupees: z.coerce.number().min(1, "Enter a daily wage").max(100000),
  contractorId: z.string().optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export type LaborerFormValues = z.input<typeof laborerFormSchema>;

export function laborerFormToInput(
  v: z.output<typeof laborerFormSchema>,
): CreateLaborerInput {
  return {
    fullName: v.fullName,
    phone: v.phone ?? null,
    trade: v.trade,
    dailyWagePaise: toPaise(v.dailyWageRupees),
    contractorId: v.contractorId || null,
    notes: v.notes || null,
  };
}

export const contractorFormSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(80),
  phone,
});

export type ContractorFormValues = z.input<typeof contractorFormSchema>;

/** Attendance mutation payload — validated before entering the sync outbox. */
export const attendanceMutationSchema = z.object({
  projectId: z.string().uuid(),
  laborerId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["PRESENT", "ABSENT", "HALF_DAY"]).nullable(),
  otHours: z.number().min(0).max(24),
  wageRatePaise: z.number().int().min(0),
  wagePayablePaise: z.number().int().min(0),
});

export type AttendanceMutation = z.infer<typeof attendanceMutationSchema>;
