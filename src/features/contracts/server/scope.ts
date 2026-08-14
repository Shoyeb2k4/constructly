"use server";

/**
 * Agreement scope and effective-dated rates.
 *
 * A scope item says "this agreement covers Mason at ₹900/day". The rate on it is
 * a read accelerator; the authoritative history is the append-only revision
 * ledger, which is why an agreed rate is never overwritten — a change is a new
 * row, and so is a correction. Attendance then resolves the rate that was in
 * force on the attendance row's OWN date, so a renegotiation mid-project can
 * never rewrite what past work was worth.
 */

import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/permissions";
import { effectiveRateOn, validateRateRevision } from "../rates";
import { addScopeItemSchema, setScopeRateSchema, updateScopeItemSchema } from "../schema";
import type { AddScopeItemInput, RateRevision, ScopeItem, SetScopeRateInput } from "../types";
import {
  iso,
  loadAgreement,
  logContract,
  projectScope,
  scopeItemInclude,
  toRateRevision,
  toScopeItem,
} from "./internal";

/** Today in the server's timezone, as YYYY-MM-DD. */
const todayISO = () => iso(new Date());

export async function listScopeItems(contractId: string): Promise<ScopeItem[]> {
  const user = await requirePermission("contracts.view");
  await loadAgreement(user, contractId);
  const rows = await prisma.contractScopeItem.findMany({
    where: { contractId, companyId: user.company.id, deletedAt: null },
    include: scopeItemInclude,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toScopeItem);
}

/**
 * Add a labour type to an agreement's scope, together with its opening rate.
 * Both in one transaction: a scope item with no rate history would be a rate
 * nobody agreed to.
 */
export async function addScopeItem(input: AddScopeItemInput): Promise<ScopeItem> {
  const user = await requirePermission("contracts.edit");
  const data = addScopeItemSchema.parse(input);
  const contract = await loadAgreement(user, data.contractId);

  const invalid = validateRateRevision({
    ratePaise: data.ratePaise,
    effectiveFrom: data.effectiveFrom,
    agreementStartDate: contract.startDate ? iso(contract.startDate) : null,
  });
  if (invalid) throw new Error(`INVALID_RATE: ${invalid}`);

  // Never trust a client subcategory id across tenants.
  const sub = await prisma.labourSubcategory.findFirst({
    where: { id: data.labourSubcategoryId, companyId: user.company.id, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!sub) throw new Error("INVALID_LABOUR_TYPE");

  const existing = await prisma.contractScopeItem.findFirst({
    where: {
      contractId: data.contractId,
      labourSubcategoryId: data.labourSubcategoryId,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (existing) throw new Error("SCOPE_ITEM_EXISTS");

  const created = await prisma.$transaction(async (tx) => {
    const item = await tx.contractScopeItem.create({
      data: {
        companyId: user.company.id,
        projectId: contract.projectId,
        contractId: data.contractId,
        labourSubcategoryId: data.labourSubcategoryId,
        // Only the opening rate is "current" if it is already in force; a
        // future-dated opening rate leaves the accelerator at that value anyway,
        // since there is nothing earlier to resolve to.
        currentRatePaise: data.ratePaise,
        rateUnit: data.rateUnit,
        notes: data.notes ?? null,
        createdById: user.id,
      },
      include: scopeItemInclude,
    });

    await tx.contractScopeRateRevision.create({
      data: {
        companyId: user.company.id,
        projectId: contract.projectId,
        contractId: data.contractId,
        scopeItemId: item.id,
        ratePaise: data.ratePaise,
        rateUnit: data.rateUnit,
        effectiveFrom: new Date(data.effectiveFrom),
        reason: "Original agreement",
        createdById: user.id,
      },
    });

    await logContract(
      tx,
      user,
      "contract.scope_added",
      "contractor_contract",
      data.contractId,
      `Added "${sub.name}" to agreement "${contract.title}"`,
      { labourSubcategoryId: sub.id, ratePaise: data.ratePaise, effectiveFrom: data.effectiveFrom },
    );
    return item;
  });
  return toScopeItem(created);
}

export async function updateScopeItem(
  id: string,
  patch: { notes?: string | null },
): Promise<ScopeItem> {
  const user = await requirePermission("contracts.edit");
  const data = updateScopeItemSchema.parse(patch);
  const item = await prisma.contractScopeItem.findFirst({
    where: { id, companyId: user.company.id, deletedAt: null, ...projectScope(user) },
    include: scopeItemInclude,
  });
  if (!item) throw new Error("NOT_FOUND");

  const updated = await prisma.contractScopeItem.update({
    where: { id },
    data: { ...(data.notes !== undefined ? { notes: data.notes } : {}) },
    include: scopeItemInclude,
  });
  return toScopeItem(updated);
}

/**
 * Remove a labour type from scope. Refused once attendance has been recorded
 * against this agreement for that labour type: those rows resolve their rate
 * through this scope item's history, and history must stay resolvable.
 */
export async function removeScopeItem(id: string): Promise<void> {
  const user = await requirePermission("contracts.edit");
  const item = await prisma.contractScopeItem.findFirst({
    where: { id, companyId: user.company.id, deletedAt: null, ...projectScope(user) },
    include: { ...scopeItemInclude, contract: { select: { title: true } } },
  });
  if (!item) throw new Error("NOT_FOUND");

  const used = await prisma.labourAttendance.count({
    where: {
      companyId: user.company.id,
      contractId: item.contractId,
      labourSubcategoryId: item.labourSubcategoryId,
    },
  });
  if (used > 0) throw new Error("SCOPE_IN_USE");

  await prisma.$transaction(async (tx) => {
    await tx.contractScopeItem.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: user.id },
    });
    await logContract(
      tx,
      user,
      "contract.scope_removed",
      "contractor_contract",
      item.contractId,
      `Removed "${item.subcategory.name}" from agreement "${item.contract.title}"`,
      { labourSubcategoryId: item.labourSubcategoryId },
    );
  });
}

export async function listRateRevisions(scopeItemId: string): Promise<RateRevision[]> {
  const user = await requirePermission("contracts.view");
  const item = await prisma.contractScopeItem.findFirst({
    where: { id: scopeItemId, companyId: user.company.id, ...projectScope(user) },
    select: { id: true },
  });
  if (!item) throw new Error("NOT_FOUND");

  const rows = await prisma.contractScopeRateRevision.findMany({
    where: { scopeItemId, companyId: user.company.id },
    include: { createdBy: { select: { fullName: true } } },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toRateRevision);
}

/**
 * Revise a scope item's rate. APPENDS a revision — the previous rate is never
 * touched, so historical attendance keeps valuing at the rate that applied on
 * its own date.
 *
 * `currentRatePaise` is then recomputed from the whole ledger as at today, not
 * simply set to the new value: a future-dated revision must not change what the
 * agreement charges right now.
 */
export async function setScopeRate(input: SetScopeRateInput): Promise<ScopeItem> {
  const user = await requirePermission("contracts.edit");
  const data = setScopeRateSchema.parse(input);

  const item = await prisma.contractScopeItem.findFirst({
    where: { id: data.scopeItemId, companyId: user.company.id, deletedAt: null, ...projectScope(user) },
    include: { ...scopeItemInclude, contract: { select: { title: true, startDate: true } } },
  });
  if (!item) throw new Error("NOT_FOUND");

  const invalid = validateRateRevision({
    ratePaise: data.ratePaise,
    effectiveFrom: data.effectiveFrom,
    agreementStartDate: item.contract.startDate ? iso(item.contract.startDate) : null,
  });
  if (invalid) throw new Error(`INVALID_RATE: ${invalid}`);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.contractScopeRateRevision.create({
      data: {
        companyId: user.company.id,
        projectId: item.projectId,
        contractId: item.contractId,
        scopeItemId: item.id,
        ratePaise: data.ratePaise,
        rateUnit: data.rateUnit,
        effectiveFrom: new Date(data.effectiveFrom),
        reason: data.reason ?? null,
        createdById: user.id,
      },
    });

    const all = await tx.contractScopeRateRevision.findMany({
      where: { scopeItemId: item.id, companyId: user.company.id },
      select: { id: true, ratePaise: true, rateUnit: true, effectiveFrom: true, createdAt: true },
    });
    const inForce = effectiveRateOn(
      all.map((r) => ({
        id: r.id,
        ratePaise: r.ratePaise,
        rateUnit: r.rateUnit,
        effectiveFrom: iso(r.effectiveFrom),
        createdAt: r.createdAt.toISOString(),
      })),
      todayISO(),
    );

    const row = await tx.contractScopeItem.update({
      where: { id: item.id },
      data: {
        currentRatePaise: inForce?.ratePaise ?? item.currentRatePaise,
        rateUnit: inForce?.rateUnit ?? item.rateUnit,
      },
      include: scopeItemInclude,
    });

    await logContract(
      tx,
      user,
      "contract.rate_revised",
      "contractor_contract",
      item.contractId,
      `Revised "${item.subcategory.name}" rate on agreement "${item.contract.title}"`,
      {
        labourSubcategoryId: item.labourSubcategoryId,
        fromRatePaise: item.currentRatePaise,
        toRatePaise: data.ratePaise,
        effectiveFrom: data.effectiveFrom,
        reason: data.reason ?? null,
      },
    );
    return row;
  });
  return toScopeItem(updated);
}
