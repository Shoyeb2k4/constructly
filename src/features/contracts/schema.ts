/**
 * Server-side validation for contractor agreements. The client never decides
 * what is acceptable — every action re-parses its input here before touching the
 * database.
 */
import { z } from "zod";
import { isValidISODate } from "./rates";

const paise = z.number().int().min(0);

/**
 * A real calendar date, not merely the right shape. A bare regex accepts
 * "2026-13-45", which then becomes an Invalid Date and surfaces as an opaque
 * Prisma error instead of a field-level message.
 */
const isoDate = z
  .string()
  .refine(isValidISODate, "Expected a valid date (YYYY-MM-DD)");

const paymentType = z.enum([
  "ADVANCE",
  "INTERIM",
  "MILESTONE",
  "WEEKLY",
  "DAILY",
  "FINAL",
  "OTHER",
]);
const paymentMode = z.enum(["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "CARD", "OTHER"]);
const contractStatus = z.enum([
  "NOT_STARTED",
  "IN_PROGRESS",
  "ON_HOLD",
  "COMPLETED",
  "SETTLED",
  "CANCELLED",
]);
const milestoneStatus = z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
const amendmentType = z.enum([
  "VARIATION",
  "SCOPE_CHANGE",
  "RATE_CHANGE",
  "TIME_EXTENSION",
  "OTHER",
]);

/* ── Agreements ─────────────────────────────────────────────────────────── */

export const createContractSchema = z.object({
  contractorId: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().trim().min(1, "Work title is required").max(160),
  reference: z.string().trim().max(80).optional().nullable(),
  scope: z.string().trim().max(2000).optional().nullable(),
  quantity: z.number().finite().min(0).optional().nullable(),
  unit: z.string().trim().max(40).optional().nullable(),
  contractAmountPaise: paise.min(1, "Agreement value is required"),
  startDate: isoDate.optional().nullable(),
  expectedCompletionDate: isoDate.optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

/**
 * Work-detail edits only. There is deliberately NO amount field: the commercial
 * value changes exclusively through a proposed-and-approved amendment, so it
 * always carries a reason, an effective date and an approver. `updateContract`
 * additionally rejects an amount if one is smuggled in (USE_AMENDMENT).
 */
export const updateContractSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  reference: z.string().trim().max(80).optional().nullable(),
  scope: z.string().trim().max(2000).optional().nullable(),
  quantity: z.number().finite().min(0).optional().nullable(),
  unit: z.string().trim().max(40).optional().nullable(),
  startDate: isoDate.optional().nullable(),
  expectedCompletionDate: isoDate.optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const setContractStatusSchema = z.object({ status: contractStatus });

export const cancelContractSchema = z.object({
  reason: z.string().trim().min(1, "A cancellation reason is required").max(500),
});

/* ── Scope & rates ──────────────────────────────────────────────────────── */

export const addScopeItemSchema = z.object({
  contractId: z.string().uuid(),
  labourSubcategoryId: z.string().uuid(),
  ratePaise: paise.min(1, "Rate is required"),
  rateUnit: z.string().trim().min(1).max(20).default("day"),
  effectiveFrom: isoDate,
  notes: z.string().trim().max(500).optional().nullable(),
});

export const updateScopeItemSchema = z.object({
  notes: z.string().trim().max(500).optional().nullable(),
});

export const setScopeRateSchema = z.object({
  scopeItemId: z.string().uuid(),
  ratePaise: paise.min(1, "Rate is required"),
  rateUnit: z.string().trim().min(1).max(20).default("day"),
  effectiveFrom: isoDate,
  reason: z.string().trim().max(500).optional().nullable(),
});

/* ── Milestones ─────────────────────────────────────────────────────────── */

export const createMilestoneSchema = z.object({
  contractId: z.string().uuid(),
  title: z.string().trim().min(1, "Milestone name is required").max(160),
  description: z.string().trim().max(2000).optional().nullable(),
  valuePaise: paise.min(1, "Milestone value is required"),
  plannedDate: isoDate.optional().nullable(),
  sequence: z.number().int().min(0).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const updateMilestoneSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  valuePaise: paise.min(1).optional(),
  plannedDate: isoDate.optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const setMilestoneStatusSchema = z.object({
  status: milestoneStatus,
  reason: z.string().trim().max(500).optional().nullable(),
});

/* ── Amendments ─────────────────────────────────────────────────────────── */

export const proposeAmendmentSchema = z.object({
  contractId: z.string().uuid(),
  type: amendmentType,
  revisedAmountPaise: paise.min(1, "Revised value is required"),
  // Required, not optional: a commercial value change with no stated reason is
  // not auditable, and this is the only path that can change one.
  reason: z.string().trim().min(1, "A reason is required").max(1000),
  effectiveDate: isoDate,
});

export const rejectAmendmentSchema = z.object({
  reason: z.string().trim().min(1, "A rejection reason is required").max(500),
});

/* ── Payments ───────────────────────────────────────────────────────────── */

/**
 * Note what is absent: no override flag. Total credits may never exceed the
 * authorised agreement value, and the only way to raise that ceiling is an
 * approved amendment.
 */
export const recordContractPaymentSchema = z.object({
  contractId: z.string().uuid(),
  amountPaise: paise.min(1, "Amount is required"),
  type: paymentType,
  paymentMode,
  date: isoDate,
  referenceNumber: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  milestoneId: z.string().uuid().optional().nullable(),
  clientUuid: z.string().uuid().optional().nullable(),
});

export const reverseContractPaymentSchema = z.object({
  reason: z.string().trim().min(1, "A reversal reason is required").max(500),
});
