import { z } from "zod";
import { PROJECT_TYPES } from "./constants";
import type { CreateProjectInput, ProjectType, UpdateProjectInput } from "./types";
import { toPaise } from "@/lib/money";

const optionalString = z
  .string()
  .trim()
  .max(200)
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined));

/** Indian mobile number, blank → undefined. Shared by the create + edit forms. */
const phoneField = z
  .string()
  .trim()
  .regex(/^(\+91[-\s]?)?[6-9]\d{9}$/, "Enter a valid Indian mobile number")
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined));

const emailField = z
  .string()
  .trim()
  .email("Enter a valid email")
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined));

/** Number `<input>` where blank means "not provided" (undefined), not 0 —
 *  `z.coerce.number()` alone would turn "" into 0. */
const optionalNumber = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" || v == null ? undefined : v), schema.optional());

/** Cross-field rule reused by the create form, the Details panel, and the server. */
const completionOnOrAfterStart = (v: {
  startDate?: string | null;
  expectedCompletionDate?: string | null;
}) =>
  !v.startDate ||
  !v.expectedCompletionDate ||
  new Date(v.expectedCompletionDate) >= new Date(v.startDate);

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
    clientPhone: phoneField,
    clientEmail: emailField,
    siteAddress: optionalString,
    gpsLat: optionalNumber(z.coerce.number().min(-90).max(90)),
    gpsLng: optionalNumber(z.coerce.number().min(-180).max(180)),
    budgetRupees: z.coerce.number().min(0, "Cannot be negative").default(0),
    contractValueRupees: z.coerce.number().min(0).default(0),
    /** Optional dedicated procurement budget (blank = not set). */
    procurementBudgetRupees: z.coerce.number().min(0, "Cannot be negative").optional(),
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
    procurementBudgetPaise: v.procurementBudgetRupees != null ? toPaise(v.procurementBudgetRupees) : null,
    startDate: v.startDate || null,
    expectedCompletionDate: v.expectedCompletionDate || null,
    pmId: v.pmId || null,
    tags: v.tags ?? [],
  };
}

/* ── Per-section edit schemas (detail-page inline panels) ─────────────── */

export const budgetSectionSchema = z.object({
  budgetRupees: z.coerce.number().min(0, "Cannot be negative").default(0),
  contractValueRupees: z.coerce.number().min(0, "Cannot be negative").default(0),
  procurementBudgetRupees: optionalNumber(z.coerce.number().min(0, "Cannot be negative")),
});
export type BudgetSectionValues = z.input<typeof budgetSectionSchema>;
export function budgetSectionToPatch(v: z.output<typeof budgetSectionSchema>): UpdateProjectInput {
  return {
    budgetPaise: toPaise(v.budgetRupees ?? 0),
    contractValuePaise: toPaise(v.contractValueRupees ?? 0),
    procurementBudgetPaise: v.procurementBudgetRupees != null ? toPaise(v.procurementBudgetRupees) : null,
  };
}

export const clientSectionSchema = z.object({
  clientName: optionalString,
  clientContact: optionalString,
  clientPhone: phoneField,
  clientEmail: emailField,
  siteAddress: optionalString,
});
export type ClientSectionValues = z.input<typeof clientSectionSchema>;
export function clientSectionToPatch(v: z.output<typeof clientSectionSchema>): UpdateProjectInput {
  return {
    clientName: v.clientName ?? null,
    clientContact: v.clientContact ?? null,
    clientPhone: v.clientPhone ?? null,
    clientEmail: v.clientEmail ?? null,
    siteAddress: v.siteAddress ?? null,
  };
}

export const detailsSectionSchema = z
  .object({
    type: z.enum(PROJECT_TYPES as [ProjectType, ...ProjectType[]]),
    startDate: z.string().optional().or(z.literal("")),
    expectedCompletionDate: z.string().optional().or(z.literal("")),
    pmId: z.string().optional().or(z.literal("")),
  })
  .refine(completionOnOrAfterStart, {
    message: "Completion date must be on or after the start date",
    path: ["expectedCompletionDate"],
  });
export type DetailsSectionValues = z.input<typeof detailsSectionSchema>;
/** Fields the generic `update` handles; `pmId` is applied separately (assignManager). */
export function detailsSectionToPatch(v: z.output<typeof detailsSectionSchema>): UpdateProjectInput {
  return {
    type: v.type,
    startDate: v.startDate || null,
    expectedCompletionDate: v.expectedCompletionDate || null,
  };
}

export const locationSectionSchema = z
  .object({
    gpsLat: optionalNumber(z.coerce.number().min(-90, "Latitude out of range").max(90, "Latitude out of range")),
    gpsLng: optionalNumber(z.coerce.number().min(-180, "Longitude out of range").max(180, "Longitude out of range")),
  })
  .refine((v) => (v.gpsLat == null) === (v.gpsLng == null), {
    message: "Provide both latitude and longitude, or neither",
    path: ["gpsLng"],
  });
export type LocationSectionValues = z.input<typeof locationSectionSchema>;
export function locationSectionToPatch(v: z.output<typeof locationSectionSchema>): UpdateProjectInput {
  return { gpsLat: v.gpsLat ?? null, gpsLng: v.gpsLng ?? null };
}

/**
 * Server-side validation for `updateProject` (paise-based partial patch), so the
 * API enforces the same rules as the create form regardless of the caller.
 * Unknown keys (e.g. `pmId`, `code`) are stripped — `pmId` has its own action.
 */
export const updateProjectInputSchema = z
  .object({
    name: z.string().trim().min(2, "Name is too short").max(120).optional(),
    type: z.enum(PROJECT_TYPES as [ProjectType, ...ProjectType[]]).optional(),
    clientName: z.string().trim().max(200).nullish(),
    clientContact: z.string().trim().max(200).nullish(),
    clientPhone: z
      .string()
      .trim()
      .regex(/^(\+91[-\s]?)?[6-9]\d{9}$/, "Enter a valid Indian mobile number")
      .nullish(),
    clientEmail: z.string().trim().email("Enter a valid email").nullish(),
    siteAddress: z.string().trim().max(200).nullish(),
    gpsLat: z.number().min(-90).max(90).nullish(),
    gpsLng: z.number().min(-180).max(180).nullish(),
    budgetPaise: z.number().int().min(0, "Cannot be negative").optional(),
    contractValuePaise: z.number().int().min(0, "Cannot be negative").optional(),
    procurementBudgetPaise: z.number().int().min(0, "Cannot be negative").nullish(),
    startDate: z.string().nullish(),
    expectedCompletionDate: z.string().nullish(),
    tags: z.array(z.string()).optional(),
  })
  .refine(completionOnOrAfterStart, {
    message: "Completion date must be on or after the start date",
    path: ["expectedCompletionDate"],
  });

/* ── Contractor↔category assignments (create form + edit sheet + server) ── */

export const contractorAssignmentInputSchema = z.object({
  contractorId: z.string().uuid(),
  labourCategoryId: z.string().uuid(),
});
/** A project's full assignment set. Server dedupes; UI guards obvious dupes. */
export const contractorAssignmentsSchema = z
  .array(contractorAssignmentInputSchema)
  .max(100, "Too many contractor assignments");

export const deadlineSchema = z.object({
  title: z.string().trim().min(1, "Required").max(120),
  dueDate: z.string().min(1, "Pick a date"),
});

export const noteSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});
