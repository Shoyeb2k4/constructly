import { z } from "zod";
import { PROJECT_TYPES } from "./constants";
import type { CreateProjectInput, ProjectType } from "./types";
import { toPaise } from "@/lib/money";

const optionalString = z
  .string()
  .trim()
  .max(200)
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined));

/** Form schema (rupees + strings from inputs). Shared client + server. */
export const projectFormSchema = z
  .object({
    name: z.string().trim().min(2, "Name is too short").max(120),
    code: z
      .string()
      .trim()
      .regex(/^[A-Z0-9-]{3,20}$/, "3–20 chars: A–Z, 0–9, hyphen")
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? v : undefined)),
    type: z.enum(PROJECT_TYPES as [ProjectType, ...ProjectType[]]),
    clientName: optionalString,
    clientContact: optionalString,
    clientPhone: z
      .string()
      .trim()
      .regex(/^(\+91[-\s]?)?[6-9]\d{9}$/, "Enter a valid Indian mobile number")
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? v : undefined)),
    clientEmail: z
      .string()
      .trim()
      .email("Enter a valid email")
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? v : undefined)),
    siteAddress: optionalString,
    gpsLat: z.coerce.number().min(-90).max(90).optional(),
    gpsLng: z.coerce.number().min(-180).max(180).optional(),
    budgetRupees: z.coerce.number().min(0, "Cannot be negative").default(0),
    contractValueRupees: z.coerce.number().min(0).default(0),
    startDate: z.string().optional().or(z.literal("")),
    expectedCompletionDate: z.string().optional().or(z.literal("")),
    pmId: z.string().optional().or(z.literal("")),
    tags: z.array(z.string()).optional(),
  })
  .refine(
    (v) =>
      !v.startDate ||
      !v.expectedCompletionDate ||
      new Date(v.expectedCompletionDate) >= new Date(v.startDate),
    {
      message: "Completion date must be on or after the start date",
      path: ["expectedCompletionDate"],
    },
  )
  .refine((v) => (v.gpsLat == null) === (v.gpsLng == null), {
    message: "Provide both latitude and longitude, or neither",
    path: ["gpsLng"],
  });

export type ProjectFormValues = z.input<typeof projectFormSchema>;

/** Map validated form values to the repository's paise-based input. */
export function formToInput(v: z.output<typeof projectFormSchema>): CreateProjectInput {
  return {
    name: v.name,
    code: v.code,
    type: v.type,
    clientName: v.clientName ?? null,
    clientContact: v.clientContact ?? null,
    clientPhone: v.clientPhone ?? null,
    clientEmail: v.clientEmail ?? null,
    siteAddress: v.siteAddress ?? null,
    gpsLat: v.gpsLat ?? null,
    gpsLng: v.gpsLng ?? null,
    budgetPaise: toPaise(v.budgetRupees ?? 0),
    contractValuePaise: toPaise(v.contractValueRupees ?? 0),
    startDate: v.startDate || null,
    expectedCompletionDate: v.expectedCompletionDate || null,
    pmId: v.pmId || null,
    tags: v.tags ?? [],
  };
}

export const deadlineSchema = z.object({
  title: z.string().trim().min(1, "Required").max(120),
  dueDate: z.string().min(1, "Pick a date"),
});

export const noteSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});
