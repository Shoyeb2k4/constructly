"use server";

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission, hasAnyPermission } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import { Prisma } from "@/generated/prisma";
import {
  agingBuckets,
  lineAmountPaise,
  lineGstPaise,
  poPaymentStatus,
  poTotals,
  projectProcurementSummary,
  projectVendorRollups,
  vendorProjectRollups,
  outstandingPaise,
  poCounted,
  type PaymentForRollup,
  type POForRollup,
} from "../calc";
import { DEFAULT_MATERIAL_CATEGORIES, UNITS } from "../constants";
import { displayMaterialName, normalizeMaterialName } from "../material-backfill";
import {
  distinctMaterialLabels,
  materialFilterIntent,
  materialIndex,
  matchesRecordedName,
  unlinkedRecordedNames,
} from "../material-identity";
import {
  buildMirror,
  planLegacyVendorMaterials,
  unlinkedLegacyNames,
  type MasterMaterialRef,
} from "../vendor-legacy-materials";
import type {
  CreateMaterialInput,
  CreatePaymentInput,
  CreatePOInput,
  CreateVendorInput,
  Material,
  MaterialFilters,
  PaymentFilters,
  POLineItemInput,
  UpdateMaterialInput,
  POFilters,
  POSort,
  ProjectProcurement,
  PurchaseOrderDetail,
  PurchaseOrderListItem,
  UpdateVendorInput,
  Vendor,
  VendorDetail,
  VendorFilters,
  VendorMaterialRef,
  VendorPaymentItem,
  VendorStatus,
} from "../types";
import type { AgingBuckets } from "../calc";

/** Ownership scope for a project: broad projects.view_all reaches any project in
 *  the company, otherwise the caller must be the assigned PM. (Behaviour-
 *  identical to the previous owner-or-assigned rule; shared by PO + payment
 *  actions.) */
async function assertProjectAccess(user: SessionUser, projectId: string) {
  const p = await prisma.project.findFirst({
    where: {
      id: projectId,
      companyId: user.company.id,
      deletedAt: null,
      ...(hasPermission(user, "projects.view_all") ? {} : { pmId: user.id }),
    },
    select: { id: true },
  });
  if (!p) throw new Error("FORBIDDEN");
}
/** Tenant guard for a client-supplied vendorId — never trust a foreign FK. */
async function assertVendorAccess(user: SessionUser, vendorId: string) {
  const v = await prisma.vendor.findFirst({
    where: { id: vendorId, companyId: user.company.id },
    select: { id: true },
  });
  if (!v) throw new Error("NOT_FOUND");
}
/** Tenant guard for a client-supplied purchaseOrderId. */
async function assertPurchaseOrderAccess(user: SessionUser, purchaseOrderId: string) {
  const p = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, companyId: user.company.id },
    select: { id: true },
  });
  if (!p) throw new Error("NOT_FOUND");
}
/* ── Server-side input validation (never trust the client) ───────────── */
const poLineInputSchema = z.object({
  material: z.string().trim().min(1).max(120),
  /** Optional canonical material. Legacy callers send only `material` text. */
  materialId: z.string().min(1).nullable().optional(),
  category: z.string().max(60).nullable().optional(),
  quantity: z.number().positive(),
  unit: z.string().trim().min(1).max(20),
  ratePaise: z.number().int().min(0),
  gstRateBps: z.number().int().min(0).max(10_000),
});
const createPOInputSchema = z.object({
  vendorId: z.string().min(1),
  projectId: z.string().min(1),
  purchaseDate: z.string().min(1),
  expectedDelivery: z.string().nullable().optional(),
  invoiceNumber: z.string().max(60).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  lineItems: z.array(poLineInputSchema).min(1),
});
const createPaymentInputSchema = z.object({
  vendorId: z.string().min(1),
  projectId: z.string().min(1),
  purchaseOrderId: z.string().min(1).nullable().optional(),
  amountPaise: z.number().int().positive(),
  paymentMode: z.enum(["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "CARD", "OTHER"]),
  referenceNumber: z.string().max(80).nullable().optional(),
  date: z.string().min(1),
  remarks: z.string().max(500).nullable().optional(),
  clientUuid: z.string().min(1).max(64).nullable().optional(),
});
/** Vendor edit payload — every field validated server-side. */
const vendorPatchSchema = z.object({
  businessName: z.string().trim().min(2, "Name is too short").max(120).optional(),
  contactPerson: z.string().trim().max(80).nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  email: z.string().trim().max(120).email("Enter a valid email").nullable().optional(),
  gstin: z.string().trim().max(20).nullable().optional(),
  pan: z.string().trim().max(15).nullable().optional(),
  address: z.string().trim().max(240).nullable().optional(),
  materialsSupplied: z.array(z.string().max(60)).max(50).optional(),
  materialIds: z.array(z.string().min(1)).max(500).optional(),
  paymentTerms: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

async function approvalRequired(companyId: string): Promise<boolean> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { settings: true } });
  return (c?.settings as { poApprovalRequired?: boolean } | null)?.poApprovalRequired ?? false;
}

/* ── Rollup source fetches (small-firm scale: one query each) ────────── */

async function fetchRollupPOs(companyId: string): Promise<POForRollup[]> {
  const rows = await prisma.purchaseOrder.findMany({
    where: { companyId },
    select: {
      id: true,
      vendorId: true,
      projectId: true,
      status: true,
      totalPaise: true,
      purchaseDate: true,
      // The Material relation is resolved by Prisma as ONE batched query for
      // all lines — the current name labels a linked bucket, archived or not.
      lineItems: {
        select: { material: true, materialId: true, materialRef: { select: { id: true, name: true, deletedAt: true } } },
      },
    },
  });
  return rows.map((p) => ({
    id: p.id,
    vendorId: p.vendorId,
    projectId: p.projectId,
    status: p.status,
    totalPaise: Number(p.totalPaise),
    purchaseDate: p.purchaseDate.toISOString().slice(0, 10),
    materials: distinctMaterialLabels(
      p.lineItems,
      materialIndex(
        p.lineItems.flatMap((l) =>
          l.materialRef ? [{ id: l.materialRef.id, name: l.materialRef.name, archived: l.materialRef.deletedAt !== null }] : [],
        ),
      ),
    ),
  }));
}

/**
 * PO ids with a line whose SNAPSHOT says `name` (recorded-name filter — see
 * material-identity.ts). Postgres cannot apply the collapse-whitespace rule in
 * a Prisma `where`, so this narrows with a case-insensitive `contains` on the
 * longest word, then applies the exact normalized comparison in code. One query
 * regardless of result size.
 */
async function poIdsWithRecordedName(companyId: string, name: string): Promise<string[]> {
  const probe = displayMaterialName(name)
    .split(" ")
    .sort((a, b) => b.length - a.length)[0];
  const lines = await prisma.pOLineItem.findMany({
    where: { purchaseOrder: { companyId }, material: { contains: probe, mode: "insensitive" } },
    select: { purchaseOrderId: true, material: true },
  });
  return [...new Set(lines.filter((l) => matchesRecordedName(l.material, name)).map((l) => l.purchaseOrderId))];
}

/**
 * The vendor `where` for a material filter. Canonical: the VendorMaterial
 * relation, never the legacy mirror. The name form exists only for older apps:
 * it matches a mapped Material whose name normalizes equal (archived included —
 * a mapping may be grandfathered), or a name an older app recorded that matches
 * no Material (the one thing only the legacy column holds).
 */
async function vendorMaterialWhere(
  companyId: string,
  filters: VendorFilters,
): Promise<Prisma.VendorWhereInput> {
  const intent = materialFilterIntent(filters);
  if (!intent) return {};
  if (intent.kind === "id") return { materials: { some: { materialId: intent.materialId } } };
  const key = normalizeMaterialName(intent.name);
  const named = await prisma.material.findMany({ where: { companyId }, select: { id: true, name: true } });
  const ids = named.filter((m) => normalizeMaterialName(m.name) === key).map((m) => m.id);
  const spellings = [...new Set([intent.name, displayMaterialName(intent.name)])];
  return {
    OR: [
      ...(ids.length ? [{ materials: { some: { materialId: { in: ids } } } }] : []),
      { materialsSupplied: { hasSome: spellings } },
    ],
  };
}

async function fetchRollupPayments(companyId: string): Promise<PaymentForRollup[]> {
  const rows = await prisma.vendorPayment.findMany({
    where: { companyId },
    select: { vendorId: true, projectId: true, purchaseOrderId: true, amountPaise: true, date: true },
  });
  return rows.map((p) => ({
    vendorId: p.vendorId,
    projectId: p.projectId,
    purchaseOrderId: p.purchaseOrderId,
    amountPaise: Number(p.amountPaise),
    date: p.date.toISOString().slice(0, 10),
  }));
}

function paidByPO(payments: PaymentForRollup[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of payments) {
    if (p.purchaseOrderId) m.set(p.purchaseOrderId, (m.get(p.purchaseOrderId) ?? 0) + p.amountPaise);
  }
  return m;
}

/* ── Vendors ─────────────────────────────────────────────────────────── */

/* ── Vendor material mappings: shared resolution + write ─────────────── */

/**
 * Every vendor's mapped materials for one company, in ONE query — so the vendor
 * list can show real Material Master names without a request per row. Active
 * materials sort first (they are what a chip preview should show), then the
 * catalogue's own ordering.
 */
async function fetchVendorMaterialRefs(companyId: string): Promise<Map<string, VendorMaterialRef[]>> {
  const rows = await prisma.vendorMaterial.findMany({
    where: { companyId },
    select: {
      vendorId: true,
      material: { select: { id: true, name: true, deletedAt: true, displayOrder: true } },
    },
  });
  const grouped = new Map<string, { ref: VendorMaterialRef; order: number }[]>();
  for (const r of rows) {
    const list = grouped.get(r.vendorId) ?? [];
    list.push({
      ref: { id: r.material.id, name: r.material.name, isActive: r.material.deletedAt === null },
      order: r.material.displayOrder,
    });
    grouped.set(r.vendorId, list);
  }
  const out = new Map<string, VendorMaterialRef[]>();
  for (const [vendorId, list] of grouped) {
    list.sort(
      (a, b) =>
        Number(b.ref.isActive) - Number(a.ref.isActive) ||
        a.order - b.order ||
        a.ref.name.localeCompare(b.ref.name),
    );
    out.set(vendorId, list.map((x) => x.ref));
  }
  return out;
}

/** The resolved outcome of a requested supplied-material set. */
interface VendorMaterialPlan {
  ids: string[];
  /** Material names, for the legacy `materialsSupplied` mirror. */
  names: string[];
  added: string[];
  removed: string[];
}

/**
 * Resolve a requested supplied-material set against the caller's company and
 * the vendor's CURRENT mappings. The single place these rules live, shared by
 * create, update and setVendorMaterials:
 *
 *  - an id that does not resolve in THIS company is NOT_FOUND, foreign or not;
 *  - an archived material may be KEPT on a vendor already mapped to it — else
 *    saving an unrelated edit would either fail or silently drop the link — but
 *    may never be newly ADDED (MATERIAL_ARCHIVED).
 */
async function planVendorMaterials(
  user: SessionUser,
  materialIds: string[],
  currentIds: string[],
): Promise<VendorMaterialPlan> {
  const ids = [...new Set(materialIds)];
  const current = new Set(currentIds);
  const removed = [...current].filter((i) => !ids.includes(i));
  if (ids.length === 0) return { ids: [], names: [], added: [], removed };

  const rows = await prisma.material.findMany({
    where: { id: { in: ids }, companyId: user.company.id },
    select: { id: true, name: true, deletedAt: true },
  });
  if (rows.length !== ids.length) throw new Error("NOT_FOUND");
  if (rows.some((m) => m.deletedAt !== null && !current.has(m.id))) {
    throw new Error("MATERIAL_ARCHIVED");
  }
  return {
    ids,
    names: rows.map((m) => m.name).sort((a, b) => a.localeCompare(b)),
    added: ids.filter((i) => !current.has(i)),
    removed,
  };
}

/**
 * The write for a mapping replacement, as nested data on the VENDOR update — so
 * the vendor's fields, its mappings and the legacy mirror change in one
 * statement and cannot end up half-applied.
 *
 * `materialsSupplied` is the LEGACY MIRROR: names of the mapped materials, kept
 * only because the vendor list filter and search still match that column (Pass
 * 7 moves them onto materialId). It is written FROM the mapping, never read
 * back into it — the safe direction: existing materials' names flow into the
 * legacy column; free text never becomes a material.
 */
/** A decided mapping change for one vendor: the final set, the legacy
 *  mirror to write, and the diff the audit log records. */
interface MappingOutcome {
  ids: string[];
  mirror: string[];
  added: string[];
  removed: string[];
}

function replaceMappingsData(companyId: string, outcome: MappingOutcome) {
  return {
    materialsSupplied: outcome.mirror,
    materials: {
      deleteMany: {},
      createMany: {
        data: outcome.ids.map((materialId) => ({ companyId, materialId })),
        skipDuplicates: true,
      },
    },
  };
}

/**
 * A vendor's current mapping state, resolved inside the caller's company (a
 * foreign id is NOT_FOUND): its legacy column and its canonical mappings.
 */
async function loadMappingState(
  user: SessionUser,
  vendorId: string,
): Promise<{ column: string[]; current: MasterMaterialRef[] }> {
  const v = await prisma.vendor.findFirst({
    where: { id: vendorId, companyId: user.company.id },
    select: { id: true, materialsSupplied: true },
  });
  if (!v) throw new Error("NOT_FOUND");
  const rows = await prisma.vendorMaterial.findMany({
    where: { companyId: user.company.id, vendorId },
    select: { material: { select: { id: true, name: true, deletedAt: true } } },
  });
  return {
    column: v.materialsSupplied ?? [],
    current: rows.map((r) => ({
      id: r.material.id,
      name: r.material.name,
      isActive: r.material.deletedAt === null,
    })),
  };
}

type MappingState = Awaited<ReturnType<typeof loadMappingState>>;
const EMPTY_STATE: MappingState = { column: [], current: [] };

/** New client: ids picked from the Material Master. Legacy-only names already
 *  on the vendor are CARRIED FORWARD — the picker cannot show them, so a save
 *  from it must not be what deletes them. */
async function outcomeFromIds(
  user: SessionUser,
  materialIds: string[],
  state: MappingState,
): Promise<MappingOutcome> {
  const plan = await planVendorMaterials(user, materialIds, state.current.map((m) => m.id));
  const extras = unlinkedLegacyNames(state.column, state.current.map((m) => m.name));
  return { ids: plan.ids, mirror: buildMirror(plan.names, extras), added: plan.added, removed: plan.removed };
}

/** Old client: a full free-text list. Reconciled by the shared transition rule
 *  (see features/procurement/vendor-legacy-materials) — exact matches only,
 *  nothing created, removals only on proof of intent. */
async function outcomeFromLegacyNames(
  user: SessionUser,
  names: string[],
  state: MappingState,
): Promise<MappingOutcome> {
  const master = await prisma.material.findMany({
    where: { companyId: user.company.id },
    select: { id: true, name: true, deletedAt: true },
  });
  const plan = planLegacyVendorMaterials({
    submitted: names,
    previousColumn: state.column,
    current: state.current,
    master: master.map((m) => ({ id: m.id, name: m.name, isActive: m.deletedAt === null })),
  });
  return { ids: plan.finalIds, mirror: plan.mirror, added: plan.added, removed: plan.removed };
}

type VendorRow = Prisma.VendorGetPayload<Record<string, never>>;

function toVendor(
  v: VendorRow,
  pos: POForRollup[],
  payments: PaymentForRollup[],
  favoriteIds: Set<string>,
  approval: boolean,
  materialsByVendor: Map<string, VendorMaterialRef[]>,
): Vendor {
  const counted = pos.filter((p) => p.vendorId === v.id && poCounted(p.status, approval));
  return {
    id: v.id,
    businessName: v.businessName,
    contactPerson: v.contactPerson,
    phone: v.phone,
    email: v.email,
    gstin: v.gstin,
    pan: v.pan,
    address: v.address,
    materialsSupplied: v.materialsSupplied,
    materials: materialsByVendor.get(v.id) ?? [],
    unlinkedMaterialNames: unlinkedLegacyNames(
      v.materialsSupplied,
      (materialsByVendor.get(v.id) ?? []).map((m) => m.name),
    ),
    paymentTerms: v.paymentTerms,
    status: v.status,
    notes: v.notes,
    isFavorite: favoriteIds.has(v.id),
    totalPurchasedPaise: counted.reduce((s, p) => s + p.totalPaise, 0),
    outstandingPaise: outstandingPaise(pos, payments, { vendorId: v.id }, approval),
    poCount: counted.length,
    projectsServed: new Set(counted.map((p) => p.projectId)).size,
  };
}

async function vendorContext(user: SessionUser) {
  const [pos, payments, favorites, approval, materialsByVendor] = await Promise.all([
    fetchRollupPOs(user.company.id),
    fetchRollupPayments(user.company.id),
    prisma.vendorFavorite.findMany({ where: { userId: user.id }, select: { vendorId: true } }),
    approvalRequired(user.company.id),
    fetchVendorMaterialRefs(user.company.id),
  ]);
  return {
    pos,
    payments,
    favoriteIds: new Set(favorites.map((f) => f.vendorId)),
    approval,
    materialsByVendor,
  };
}

export async function listVendors(filters: VendorFilters = {}): Promise<Vendor[]> {
  const user = await requirePermission("vendors.view");
  const materialWhere = await vendorMaterialWhere(user.company.id, filters);
  const [rows, ctx] = await Promise.all([
    prisma.vendor.findMany({
      where: {
        companyId: user.company.id,
        ...(filters.status && filters.status !== "ALL" ? { status: filters.status } : {}),
        ...(filters.favoritesOnly ? { favorites: { some: { userId: user.id } } } : {}),
        // AND keeps the material OR and the search OR from overwriting each other.
        AND: [
          materialWhere,
          filters.search
            ? {
                // Search: name, contact, and the names of the vendor's MAPPED
                // materials (relation, case-insensitive contains — the same
                // semantics as the other fields). Not the legacy mirror.
                OR: [
                  { businessName: { contains: filters.search, mode: "insensitive" } },
                  { contactPerson: { contains: filters.search, mode: "insensitive" } },
                  { materials: { some: { material: { name: { contains: filters.search, mode: "insensitive" } } } } },
                ],
              }
            : {},
        ],
      },
      orderBy: { businessName: "asc" },
    }),
    vendorContext(user),
  ]);
  return rows.map((v) => toVendor(v, ctx.pos, ctx.payments, ctx.favoriteIds, ctx.approval, ctx.materialsByVendor));
}

export async function getVendor(id: string): Promise<VendorDetail | null> {
  const user = await requirePermission("vendors.view");
  const v = await prisma.vendor.findFirst({ where: { id, companyId: user.company.id } });
  if (!v) return null;
  const ctx = await vendorContext(user);
  const paid = paidByPO(ctx.payments);
  const [history, paymentRows, docs, projectNames] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { companyId: user.company.id, vendorId: id },
      orderBy: { purchaseDate: "desc" },
      include: { project: { select: { name: true, code: true } } },
    }),
    prisma.vendorPayment.findMany({
      where: { companyId: user.company.id, vendorId: id },
      orderBy: { date: "desc" },
      include: {
        project: { select: { name: true, code: true } },
        purchaseOrder: { select: { id: true, poNumber: true } },
        createdBy: { select: { fullName: true } },
      },
    }),
    prisma.vendorDocument.findMany({
      where: { companyId: user.company.id, vendorId: id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.project.findMany({ where: { companyId: user.company.id }, select: { id: true, name: true, code: true } }),
  ]);
  const nameById = new Map(projectNames.map((p) => [p.id, p]));
  return {
    ...toVendor(v, ctx.pos, ctx.payments, ctx.favoriteIds, ctx.approval, ctx.materialsByVendor),
    purchaseHistory: history.map((p) => ({
      id: p.id,
      poNumber: p.poNumber,
      status: p.status,
      purchaseDate: p.purchaseDate.toISOString().slice(0, 10),
      expectedDelivery: p.expectedDelivery ? p.expectedDelivery.toISOString().slice(0, 10) : null,
      subtotalPaise: Number(p.subtotalPaise),
      gstPaise: Number(p.gstPaise),
      totalPaise: Number(p.totalPaise),
      paidPaise: paid.get(p.id) ?? 0,
      paymentStatus: poPaymentStatus(Number(p.totalPaise), paid.get(p.id) ?? 0),
      invoiceNumber: p.invoiceNumber,
      vendor: { id, name: v.businessName },
      project: { id: p.projectId, name: p.project.name, code: p.project.code },
      createdAt: p.createdAt.toISOString(),
    })),
    payments: paymentRows.map((p) => ({
      id: p.id,
      vendor: { id, name: v.businessName },
      project: { id: p.projectId, name: p.project.name, code: p.project.code },
      purchaseOrder: p.purchaseOrder ? { id: p.purchaseOrder.id, poNumber: p.purchaseOrder.poNumber } : null,
      amountPaise: Number(p.amountPaise),
      paymentMode: p.paymentMode,
      referenceNumber: p.referenceNumber,
      date: p.date.toISOString().slice(0, 10),
      remarks: p.remarks,
      createdByName: p.createdBy.fullName,
      createdAt: p.createdAt.toISOString(),
    })),
    projects: vendorProjectRollups(ctx.pos, ctx.payments, id, ctx.approval).map((r) => ({
      ...r,
      project: {
        id: r.id,
        name: nameById.get(r.id)?.name ?? "Unknown",
        code: nameById.get(r.id)?.code ?? "",
      },
    })),
    documents: docs.map((d) => ({
      id: d.id,
      category: d.category,
      filename: d.filename,
      sizeBytes: d.sizeBytes,
      mimeType: d.mimeType,
      storagePath: d.storagePath,
      createdAt: d.createdAt.toISOString(),
    })),
  };
}

export async function createVendor(input: CreateVendorInput): Promise<Vendor> {
  // Supplied materials have always been part of the vendor record at creation
  // (the old free-text list was a createVendor field), so setting the initial
  // mappings is covered by vendors.create — the same authority, now expressed
  // as master ids instead of strings.
  const user = await requirePermission("vendors.create");
  if (input.materialIds !== undefined) z.array(z.string().min(1)).max(500).parse(input.materialIds);
  if (input.materialsSupplied !== undefined) z.array(z.string().max(60)).max(50).parse(input.materialsSupplied);
  const plan =
    input.materialIds !== undefined
      ? await outcomeFromIds(user, input.materialIds, EMPTY_STATE)
      : input.materialsSupplied !== undefined
        ? await outcomeFromLegacyNames(user, input.materialsSupplied, EMPTY_STATE)
        : null;

  const v = await prisma.vendor.create({
    data: {
      companyId: user.company.id,
      businessName: input.businessName,
      contactPerson: input.contactPerson ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      gstin: input.gstin ?? null,
      pan: input.pan ?? null,
      address: input.address ?? null,
      // Always the derived mirror now — for an older client, exactly-matching
      // names become mappings and the rest are kept as legacy text. Free text
      // still never becomes a material.
      materialsSupplied: plan ? plan.mirror : [],
      ...(plan && plan.ids.length > 0
        ? {
            materials: {
              createMany: {
                data: plan.ids.map((materialId) => ({ companyId: user.company.id, materialId })),
                skipDuplicates: true,
              },
            },
          }
        : {}),
      paymentTerms: input.paymentTerms ?? null,
      notes: input.notes ?? null,
    },
  });
  if (plan && plan.added.length > 0) await logVendorMaterials(user, v.id, plan.added, []);
  const ctx = await vendorContext(user);
  return toVendor(v, ctx.pos, ctx.payments, ctx.favoriteIds, ctx.approval, ctx.materialsByVendor);
}

export async function updateVendor(id: string, patch: UpdateVendorInput): Promise<Vendor> {
  const user = await requirePermission("vendors.edit");
  vendorPatchSchema.parse(patch);
  // A status change carried in the patch is a lifecycle action — require the
  // matching archive/restore permission so edit alone can't deactivate a vendor.
  if (patch.status) {
    await requirePermission(patch.status === "INACTIVE" ? "vendors.archive" : "vendors.restore");
  }
  // Neither materials field is written as-is. `materialIds` (new client) and
  // `materialsSupplied` (older app) both become a mapping outcome, which writes
  // the mappings and the derived legacy mirror together.
  const { materialIds, materialsSupplied, ...fields } = patch;

  let plan: MappingOutcome | null = null;
  if (materialIds !== undefined || materialsSupplied !== undefined) {
    // Resolving inside the caller's company first makes a foreign id a clean
    // NOT_FOUND, and the state read below unambiguously this tenant's.
    const state = await loadMappingState(user, id);
    plan =
      materialIds !== undefined
        ? await outcomeFromIds(user, materialIds, state)
        : await outcomeFromLegacyNames(user, materialsSupplied!, state);
  }

  const v = await prisma.vendor.update({
    where: { id, companyId: user.company.id },
    data: { ...fields, ...(plan ? replaceMappingsData(user.company.id, plan) : {}) },
  });
  await prisma.activityLog.create({
    data: {
      companyId: user.company.id,
      actorId: user.id,
      action: "vendor.updated",
      entityType: "vendor",
      entityId: v.id,
      summary: `Updated vendor ${v.businessName}`,
      // Mapping changes get their own event below; listing them here too would
      // record the same change twice.
      meta: { fields: Object.keys(fields) },
    },
  });
  if (plan && (plan.added.length > 0 || plan.removed.length > 0)) {
    await logVendorMaterials(user, id, plan.added, plan.removed);
  }
  const ctx = await vendorContext(user);
  return toVendor(v, ctx.pos, ctx.payments, ctx.favoriteIds, ctx.approval, ctx.materialsByVendor);
}

/** Vendor lifecycle: deactivate (archive) / reactivate (restore). Distinct
 *  permissions from vendors.edit — vendors are long-lived master data, so we
 *  prefer archive/restore over deletion and gate them separately. */
export async function setVendorStatus(id: string, status: VendorStatus): Promise<Vendor> {
  const user = await requirePermission(status === "INACTIVE" ? "vendors.archive" : "vendors.restore");
  const v = await prisma.vendor.update({ where: { id, companyId: user.company.id }, data: { status } });
  await prisma.activityLog.create({
    data: {
      companyId: user.company.id,
      actorId: user.id,
      action: status === "INACTIVE" ? "vendor.archived" : "vendor.restored",
      entityType: "vendor",
      entityId: v.id,
      summary: `${status === "INACTIVE" ? "Deactivated" : "Reactivated"} vendor ${v.businessName}`,
    },
  });
  const ctx = await vendorContext(user);
  return toVendor(v, ctx.pos, ctx.payments, ctx.favoriteIds, ctx.approval, ctx.materialsByVendor);
}

export async function toggleVendorFavorite(id: string): Promise<boolean> {
  const user = await requirePermission("vendors.view");
  const existing = await prisma.vendorFavorite.findUnique({
    where: { userId_vendorId: { userId: user.id, vendorId: id } },
  });
  if (existing) {
    await prisma.vendorFavorite.delete({ where: { userId_vendorId: { userId: user.id, vendorId: id } } });
    return false;
  }
  await prisma.vendorFavorite.create({ data: { userId: user.id, vendorId: id } });
  return true;
}

export async function addVendorDocument(
  vendorId: string,
  doc: { filename: string; sizeBytes: number; mimeType: string },
): Promise<VendorDetail> {
  // Attaching a document is a low-privilege collaborative action, historically
  // available to any member — keep it at viewer level (not vendors.edit).
  const user = await requirePermission("vendors.view");
  const category = doc.mimeType.startsWith("image/")
    ? "PHOTO"
    : doc.mimeType === "application/pdf"
      ? "PDF"
      : "OTHER";
  await prisma.vendorDocument.create({
    data: {
      companyId: user.company.id,
      vendorId,
      category,
      storagePath: `${user.company.id}/vendors/${vendorId}/${doc.filename}`,
      filename: doc.filename,
      sizeBytes: doc.sizeBytes,
      mimeType: doc.mimeType,
      uploadedById: user.id,
    },
  });
  return (await getVendor(vendorId))!;
}

export async function removeVendorDocument(vendorId: string, docId: string): Promise<VendorDetail> {
  const user = await requirePermission("vendors.view");
  await prisma.vendorDocument.delete({ where: { id: docId, companyId: user.company.id } });
  return (await getVendor(vendorId))!;
}

/* ── Material category presets (Company.settings) ────────────────────── */

/** The write itself. Holds NO permission check — every caller gates first. Kept
 *  private so the only ways in are the two exported functions below. */
async function writeMaterialCategories(companyId: string, categories: string[]): Promise<string[]> {
  const clean = [...new Set(categories.map((c) => c.trim()).filter(Boolean))];
  const c = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { settings: true },
  });
  await prisma.company.update({
    where: { id: companyId },
    data: { settings: { ...(c.settings as object), materialCategories: clean } },
  });
  return clean;
}

/** READ stays open to any authenticated member. The PO editor's category
 *  dropdown calls this on every purchase order, so gating it behind a materials
 *  permission would block ordinary PO creation. Read access and write access
 *  are deliberately NOT the same gate. */
export async function listMaterialCategories(): Promise<string[]> {
  const user = await requireUser();
  const c = await prisma.company.findUnique({ where: { id: user.company.id }, select: { settings: true } });
  const stored = (c?.settings as { materialCategories?: string[] } | null)?.materialCategories;
  if (Array.isArray(stored) && stored.length) return stored;
  // First-run lazy seed of the built-in presets. Deliberately NOT gated: it is
  // not a user edit — it can only ever write DEFAULT_MATERIAL_CATEGORIES, and
  // only when nothing is stored yet. Routing it through the exported (gated)
  // setter instead would make the FIRST purchase order raised by anyone without
  // materials.edit fail with FORBIDDEN.
  return writeMaterialCategories(user.company.id, [...DEFAULT_MATERIAL_CATEGORIES]);
}

/**
 * WRITE requires materials.edit. The category list is company-wide procurement
 * master data — it defines how every PO line is classified and drives every
 * procurement filter and analytics breakdown — so it is gated by the authority
 * over that master data, not by company.edit. This follows setProjectRetention,
 * which likewise writes to `companies` but is gated by the domain permission it
 * governs (projects.delete) rather than by a company-settings permission.
 *
 * Previously this was `requireUser()` only, so any authenticated member of any
 * role could rewrite or empty the company's taxonomy.
 */
export async function setMaterialCategories(categories: string[]): Promise<string[]> {
  const user = await requirePermission("materials.edit");
  const before = await listMaterialCategories();
  const clean = await writeMaterialCategories(user.company.id, categories);
  await prisma.activityLog.create({
    data: {
      companyId: user.company.id,
      actorId: user.id,
      action: "material_categories.updated",
      entityType: "company",
      entityId: user.company.id,
      summary: `Updated material categories (${before.length} -> ${clean.length})`,
      // The whole list is bounded and small, and which categories exist is the
      // point of the record — a count alone would not say what changed.
      meta: {
        added: clean.filter((c) => !before.includes(c)),
        removed: before.filter((c) => !clean.includes(c)),
        categories: clean,
      },
    },
  });
  return clean;
}

/* ── Material master ─────────────────────────────────────────────────── */

/**
 * Who may READ the catalogue for selection and display.
 *
 * Holding any of these lets a caller LIST and RESOLVE materials. None of them
 * confers management — creating, editing and archiving each require their own
 * `materials.*` permission, checked separately below.
 *
 * `purchase_orders.create` is here because a PO creator must be able to pick a
 * material; without it a Project Manager could be blocked mid-order by a
 * permission that has nothing to do with raising the order. `purchase_orders.view`
 * and `vendors.view` are here because the procurement and vendor list filters
 * already render a Material dropdown for anyone who can see those screens —
 * `listMaterials` is gated on `vendors.view` today, and narrowing that would be
 * a regression, not a tightening.
 */
const MATERIAL_READ_PERMISSIONS = [
  "materials.view",
  "materials.create",
  "purchase_orders.view",
  "purchase_orders.create",
  "vendors.view",
] as const;

async function requireMaterialRead(): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasAnyPermission(user, [...MATERIAL_READ_PERMISSIONS])) throw new Error("FORBIDDEN");
  return user;
}

type MaterialRow = Prisma.MaterialGetPayload<Record<string, never>>;

function toMaterial(m: MaterialRow): Material {
  return {
    id: m.id,
    name: m.name,
    category: m.category,
    defaultUnit: m.defaultUnit,
    hsnCode: m.hsnCode,
    displayOrder: m.displayOrder,
    isActive: m.deletedAt === null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

const materialInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a material name").max(120),
  category: z.string().trim().max(60).nullable().optional(),
  defaultUnit: z.string().trim().max(20).nullable().optional(),
  hsnCode: z.string().trim().max(10).regex(/^\d*$/, "HSN code is digits only").nullable().optional(),
});
const materialPatchSchema = materialInputSchema.partial().extend({
  displayOrder: z.number().int().min(0).optional(),
});

/** A unit must be one the rest of the app can render. */
function assertValidUnit(unit: string | null | undefined): void {
  if (unit === null || unit === undefined || unit === "") return;
  if (!(UNITS as readonly string[]).includes(unit)) throw new Error("INVALID_UNIT");
}

/**
 * Category validation, deliberately asymmetric.
 *
 * On CREATE a supplied category must exist in the company's current list — there
 * is no reason to file a brand-new material under a category nobody uses.
 *
 * On UPDATE the record's OWN existing category is also accepted, even if it has
 * since been removed from Settings. Otherwise retiring a category would make
 * every material still carrying it permanently uneditable — you could not even
 * fix its unit without first re-adding a category you had deliberately dropped.
 * Historical records stay editable; that is the whole point.
 */
async function assertValidCategory(
  companyId: string,
  category: string | null | undefined,
  currentValue?: string | null,
): Promise<void> {
  if (category === null || category === undefined || category === "") return;
  if (currentValue !== undefined && category === currentValue) return;
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { settings: true } });
  const stored = (c?.settings as { materialCategories?: string[] } | null)?.materialCategories;
  const allowed = Array.isArray(stored) && stored.length ? stored : [...DEFAULT_MATERIAL_CATEGORIES];
  if (!allowed.includes(category)) throw new Error("INVALID_CATEGORY");
}

/** Case-insensitive active-name collision, excluding one id (for renames). */
async function assertNameAvailable(companyId: string, name: string, exceptId?: string): Promise<void> {
  const clash = await prisma.material.findFirst({
    where: {
      companyId,
      deletedAt: null,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new Error("MATERIAL_NAME_TAKEN");
}

/** The database's partial unique index is the race-safe authority; this turns
 *  its violation into the same domain error the pre-check raises, so a losing
 *  concurrent write reads the same as a losing sequential one. */
function rethrowDuplicate(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new Error("MATERIAL_NAME_TAKEN");
  }
  throw e;
}

export async function listMaterialMaster(filters: MaterialFilters = {}): Promise<Material[]> {
  const user = await requireMaterialRead();
  const rows = await prisma.material.findMany({
    where: {
      companyId: user.company.id,
      ...(filters.includeArchived ? {} : { deletedAt: null }),
      ...(filters.category && filters.category !== "ALL" ? { category: filters.category } : {}),
      ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
    },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
  return rows.map(toMaterial);
}

/** Resolves archived materials too — a historical PO line must still be able to
 *  show what it points at. */
export async function getMaterial(id: string): Promise<Material | null> {
  const user = await requireMaterialRead();
  const m = await prisma.material.findFirst({ where: { id, companyId: user.company.id } });
  return m ? toMaterial(m) : null;
}

/**
 * LEGACY — for older apps only (see the ProcurementRepository contract). Their
 * filter dropdowns are built from this and send the chosen NAME back as
 * `material`, which the server now resolves through the Material Master (and the
 * legacy column for unmatched names). The web app no longer calls it.
 */
export async function listMaterials(): Promise<string[]> {
  const user = await requireMaterialRead();
  const [materials, vendors] = await Promise.all([
    prisma.material.findMany({
      where: { companyId: user.company.id, deletedAt: null },
      select: { name: true },
    }),
    prisma.vendor.findMany({ where: { companyId: user.company.id }, select: { materialsSupplied: true } }),
  ]);
  return [
    ...new Set([...materials.map((m) => m.name), ...vendors.flatMap((v) => v.materialsSupplied)]),
  ].sort();
}

/**
 * Recorded names on UNLINKED PO lines (materialId null), one per normalized
 * spelling — the "older orders" options of the PO material filter, so history
 * written before materials were linked stays filterable. Same visibility scope
 * as the PO list. One query (DISTINCT on the snapshot).
 */
export async function listUnlinkedMaterialNames(): Promise<string[]> {
  const user = await requirePermission("purchase_orders.view");
  const lines = await prisma.pOLineItem.findMany({
    where: {
      materialId: null,
      purchaseOrder: {
        companyId: user.company.id,
        ...(hasPermission(user, "purchase_orders.view_all") ? {} : { project: { pmId: user.id } }),
      },
    },
    select: { material: true },
    distinct: ["material"],
  });
  return unlinkedRecordedNames(lines);
}

export async function createMaterial(input: CreateMaterialInput): Promise<Material> {
  const user = await requirePermission("materials.create");
  const parsed = materialInputSchema.parse(input);
  assertValidUnit(parsed.defaultUnit);
  await assertValidCategory(user.company.id, parsed.category);
  await assertNameAvailable(user.company.id, parsed.name);

  const count = await prisma.material.count({
    where: { companyId: user.company.id, deletedAt: null },
  });
  const created = await prisma.material
    .create({
      data: {
        // Tenant comes from the SESSION. A client-supplied companyId is not part
        // of CreateMaterialInput and could not be honoured if it were sent.
        companyId: user.company.id,
        name: parsed.name,
        category: parsed.category ?? null,
        defaultUnit: parsed.defaultUnit || null,
        hsnCode: parsed.hsnCode || null,
        displayOrder: count,
      },
    })
    .catch(rethrowDuplicate);

  await prisma.activityLog.create({
    data: {
      companyId: user.company.id,
      actorId: user.id,
      action: "material.created",
      entityType: "material",
      entityId: created.id,
      summary: `Added material ${created.name}`,
      meta: { category: created.category, defaultUnit: created.defaultUnit },
    },
  });
  return toMaterial(created);
}

export async function updateMaterial(id: string, patch: UpdateMaterialInput): Promise<Material> {
  const user = await requirePermission("materials.edit");
  const parsed = materialPatchSchema.parse(patch);
  // Resolve under the caller's company FIRST: a foreign id must be
  // indistinguishable from one that does not exist.
  const existing = await prisma.material.findFirst({
    where: { id, companyId: user.company.id },
    select: { id: true, name: true, category: true },
  });
  if (!existing) throw new Error("NOT_FOUND");

  assertValidUnit(parsed.defaultUnit);
  if (parsed.category !== undefined) {
    await assertValidCategory(user.company.id, parsed.category, existing.category);
  }
  if (parsed.name !== undefined && parsed.name !== existing.name) {
    await assertNameAvailable(user.company.id, parsed.name, id);
  }

  const updated = await prisma.material
    .update({
      where: { id },
      // Field by field: `companyId` is deliberately unreachable, so no patch can
      // move a material to another tenant. A rename touches THIS row only —
      // po_line_items.material is a frozen snapshot and is never rewritten.
      data: {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.category !== undefined ? { category: parsed.category ?? null } : {}),
        ...(parsed.defaultUnit !== undefined ? { defaultUnit: parsed.defaultUnit || null } : {}),
        ...(parsed.hsnCode !== undefined ? { hsnCode: parsed.hsnCode || null } : {}),
        ...(parsed.displayOrder !== undefined ? { displayOrder: parsed.displayOrder } : {}),
      },
    })
    .catch(rethrowDuplicate);

  // A rename changes what every mapped vendor's legacy mirror should say. Left
  // alone, an older app would keep showing (and sending back) the old name, the
  // legacy filter would stop finding those vendors under the new one, and the
  // old name would read as unlinked legacy text. Only the matching ENTRY is
  // replaced; any legacy-only names beside it are untouched. PO line snapshots
  // are still never rewritten.
  if (parsed.name !== undefined && parsed.name !== existing.name) {
    const oldKey = normalizeMaterialName(existing.name);
    const mapped = await prisma.vendor.findMany({
      where: { companyId: user.company.id, materials: { some: { materialId: id } } },
      select: { id: true, materialsSupplied: true },
    });
    for (const v of mapped) {
      const next = buildMirror(
        [],
        v.materialsSupplied.map((s) => (normalizeMaterialName(s) === oldKey ? updated.name : s)),
      );
      await prisma.vendor.update({
        where: { id: v.id, companyId: user.company.id },
        data: { materialsSupplied: next },
      });
    }
  }

  await prisma.activityLog.create({
    data: {
      companyId: user.company.id,
      actorId: user.id,
      action: "material.updated",
      entityType: "material",
      entityId: id,
      summary: `Updated material ${updated.name}`,
      meta: { fields: Object.keys(parsed) },
    },
  });
  return toMaterial(updated);
}

/**
 * Deactivate or reactivate. One action for both directions, mirroring
 * setVendorStatus — a material is never deleted, so this is its whole lifecycle.
 * Both directions need `materials.archive`, which Pass 2 defined as
 * "deactivate / restore".
 *
 * Deactivating NEVER touches purchase orders: the row survives, and every PO
 * line keeps both its materialId and its frozen `material` text.
 */
export async function setMaterialArchived(id: string, archived: boolean): Promise<Material> {
  const user = await requirePermission("materials.archive");
  const existing = await prisma.material.findFirst({
    where: { id, companyId: user.company.id },
    select: { id: true, name: true, deletedAt: true },
  });
  if (!existing) throw new Error("NOT_FOUND");

  // Reactivating does not free its own name: another material may have taken it
  // while this one was inactive. The partial unique index would reject the
  // write, so check first and return a domain error instead.
  if (!archived && existing.deletedAt !== null) {
    await assertNameAvailable(user.company.id, existing.name, id);
  }

  const updated = await prisma.material
    .update({
      where: { id },
      data: archived
        ? { deletedAt: new Date(), deletedById: user.id }
        : { deletedAt: null, deletedById: null },
    })
    .catch(rethrowDuplicate);

  await prisma.activityLog.create({
    data: {
      companyId: user.company.id,
      actorId: user.id,
      action: archived ? "material.archived" : "material.restored",
      entityType: "material",
      entityId: id,
      summary: `${archived ? "Deactivated" : "Reactivated"} material ${updated.name}`,
    },
  });
  return toMaterial(updated);
}

/* ── Vendor to material links (eligibility only) ─────────────────────── */

/** Resolve a vendor inside the caller's company, or NOT_FOUND. Never reveals
 *  that the id exists for someone else. */
async function resolveVendor(user: SessionUser, vendorId: string): Promise<string> {
  const v = await prisma.vendor.findFirst({
    where: { id: vendorId, companyId: user.company.id },
    select: { id: true },
  });
  if (!v) throw new Error("NOT_FOUND");
  return v.id;
}

/**
 * Resolve material ids inside the caller's company.
 *
 * A foreign id and a nonexistent one both raise NOT_FOUND — the response must
 * not let a caller probe another tenant's identifiers. An id that resolves but
 * is deactivated raises MATERIAL_ARCHIVED, which is a different situation: the
 * caller is entitled to know the material exists, they simply cannot use it.
 */
async function resolveActiveMaterials(
  user: SessionUser,
  materialIds: string[],
): Promise<MaterialRow[]> {
  const ids = [...new Set(materialIds)];
  if (ids.length === 0) return [];
  const rows = await prisma.material.findMany({
    where: { id: { in: ids }, companyId: user.company.id },
  });
  if (rows.length !== ids.length) throw new Error("NOT_FOUND");
  if (rows.some((m) => m.deletedAt !== null)) throw new Error("MATERIAL_ARCHIVED");
  return rows;
}

async function vendorMaterialsOf(companyId: string, vendorId: string): Promise<Material[]> {
  const rows = await prisma.vendorMaterial.findMany({
    where: { companyId, vendorId, material: { deletedAt: null } },
    include: { material: true },
    orderBy: [{ material: { displayOrder: "asc" } }, { material: { name: "asc" } }],
  });
  return rows.map((r) => toMaterial(r.material));
}

export async function listVendorMaterials(vendorId: string): Promise<Material[]> {
  const user = await requireMaterialRead();
  await resolveVendor(user, vendorId);
  return vendorMaterialsOf(user.company.id, vendorId);
}

/**
 * Replace a vendor's supplied-material set. Eligibility config only: it writes
 * nothing but (vendor, material) pairs — no quantity, no amount, no date — and
 * touches no purchase order, PO line snapshot, goods receipt or report.
 */
export async function setVendorMaterials(
  vendorId: string,
  materialIds: string[],
): Promise<Material[]> {
  const user = await requirePermission("vendors.edit");
  z.array(z.string().min(1)).max(500).parse(materialIds);
  const plan = await outcomeFromIds(user, materialIds, await loadMappingState(user, vendorId));

  // One nested write on the vendor: delete + recreate the mappings and refresh
  // the legacy mirror atomically. Duplicates are structurally impossible
  // (composite PK); skipDuplicates keeps a repeated id from failing the call.
  await prisma.vendor.update({
    where: { id: vendorId, companyId: user.company.id },
    data: replaceMappingsData(user.company.id, plan),
  });

  if (plan.added.length || plan.removed.length) {
    await logVendorMaterials(user, vendorId, plan.added, plan.removed);
  }
  return vendorMaterialsOf(user.company.id, vendorId);
}

/**
 * Add one material to a vendor's usual list. Idempotent: re-adding an existing
 * link succeeds, writes nothing and logs nothing. This is what the Pass 6 PO
 * flow's "also add this to the vendor's usual materials" will call.
 */
export async function addMaterialToVendor(
  vendorId: string,
  materialId: string,
): Promise<Material[]> {
  const user = await requirePermission("vendors.edit");
  const state = await loadMappingState(user, vendorId);
  const [material] = await resolveActiveMaterials(user, [materialId]);

  const res = await prisma.vendorMaterial.createMany({
    data: [{ companyId: user.company.id, vendorId, materialId }],
    skipDuplicates: true,
  });
  if (res.count > 0) {
    // Keep the legacy mirror in step with the mapping it reflects, carrying any
    // legacy-only names forward exactly as a full save does.
    const canonical = state.current.map((m) => m.name);
    await prisma.vendor.update({
      where: { id: vendorId, companyId: user.company.id },
      data: {
        materialsSupplied: buildMirror(
          [...canonical, material.name],
          unlinkedLegacyNames(state.column, canonical),
        ),
      },
    });
    await logVendorMaterials(user, vendorId, [materialId], []);
  }
  return vendorMaterialsOf(user.company.id, vendorId);
}

/** Bounded audit payload: counts always, ids only while the list stays small. */
const AUDIT_ID_CAP = 25;
async function logVendorMaterials(
  user: SessionUser,
  vendorId: string,
  added: string[],
  removed: string[],
): Promise<void> {
  await prisma.activityLog.create({
    data: {
      companyId: user.company.id,
      actorId: user.id,
      action: "vendor.materials_updated",
      entityType: "vendor",
      entityId: vendorId,
      summary: `Updated supplied materials (+${added.length} / -${removed.length})`,
      meta: {
        vendorId,
        addedCount: added.length,
        removedCount: removed.length,
        addedIds: added.slice(0, AUDIT_ID_CAP),
        removedIds: removed.slice(0, AUDIT_ID_CAP),
        truncated: added.length > AUDIT_ID_CAP || removed.length > AUDIT_ID_CAP,
      },
    },
  });
}

/* ── Purchase orders ─────────────────────────────────────────────────── */

const poInclude = {
  vendor: { select: { businessName: true } },
  project: { select: { name: true, code: true } },
  createdBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { fullName: true } },
  revisedFrom: { select: { poNumber: true } },
  lineItems: { orderBy: { sortOrder: "asc" } },
} satisfies Prisma.PurchaseOrderInclude;

type PORow = Prisma.PurchaseOrderGetPayload<{ include: typeof poInclude }>;

type POListRow = {
  id: string; poNumber: string; status: "DRAFT" | "SUBMITTED" | "APPROVED"; purchaseDate: Date;
  expectedDelivery: Date | null; subtotalPaise: bigint; gstPaise: bigint; totalPaise: bigint;
  invoiceNumber: string | null; vendorId: string; projectId: string; createdById: string; createdAt: Date;
  vendor: { businessName: string }; project: { name: string; code: string };
  createdBy?: { id: string; fullName: string } | null;
};

function toListItem(p: POListRow, paid: Map<string, number>): PurchaseOrderListItem {
  const paidPaise = paid.get(p.id) ?? 0;
  return {
    id: p.id,
    poNumber: p.poNumber,
    status: p.status,
    purchaseDate: p.purchaseDate.toISOString().slice(0, 10),
    expectedDelivery: p.expectedDelivery ? p.expectedDelivery.toISOString().slice(0, 10) : null,
    subtotalPaise: Number(p.subtotalPaise),
    gstPaise: Number(p.gstPaise),
    totalPaise: Number(p.totalPaise),
    paidPaise,
    paymentStatus: poPaymentStatus(Number(p.totalPaise), paidPaise),
    invoiceNumber: p.invoiceNumber,
    vendor: { id: p.vendorId, name: p.vendor.businessName },
    project: { id: p.projectId, name: p.project.name, code: p.project.code },
    createdBy: p.createdBy ? { id: p.createdBy.id, name: p.createdBy.fullName } : null,
    createdAt: p.createdAt.toISOString(),
  };
}

/** Maps a sort mode to a Prisma orderBy (kept in lock-step with poComparator). */
function poOrderBy(sort: POSort = "NEWEST"): Prisma.PurchaseOrderOrderByWithRelationInput[] {
  switch (sort) {
    case "OLDEST": return [{ purchaseDate: "asc" }, { poNumber: "asc" }];
    case "AMOUNT_DESC": return [{ totalPaise: "desc" }];
    case "AMOUNT_ASC": return [{ totalPaise: "asc" }];
    case "VENDOR_ASC": return [{ vendor: { businessName: "asc" } }];
    case "VENDOR_DESC": return [{ vendor: { businessName: "desc" } }];
    case "PROJECT_ASC": return [{ project: { name: "asc" } }];
    case "PO_NUMBER": return [{ poNumber: "asc" }];
    case "STATUS": return [{ status: "asc" }, { poNumber: "asc" }];
    case "DELIVERY": return [{ expectedDelivery: { sort: "asc", nulls: "last" } }];
    case "NEWEST":
    default: return [{ purchaseDate: "desc" }, { poNumber: "desc" }];
  }
}

const paymentInclude = {
  vendor: { select: { businessName: true } },
  project: { select: { name: true, code: true } },
  purchaseOrder: { select: { id: true, poNumber: true } },
  createdBy: { select: { fullName: true } },
} satisfies Prisma.VendorPaymentInclude;

type PaymentRow = Prisma.VendorPaymentGetPayload<{ include: typeof paymentInclude }>;

function toPaymentItem(p: PaymentRow): VendorPaymentItem {
  return {
    id: p.id,
    vendor: { id: p.vendorId, name: p.vendor.businessName },
    project: { id: p.projectId, name: p.project.name, code: p.project.code },
    purchaseOrder: p.purchaseOrder ? { id: p.purchaseOrder.id, poNumber: p.purchaseOrder.poNumber } : null,
    amountPaise: Number(p.amountPaise),
    paymentMode: p.paymentMode,
    referenceNumber: p.referenceNumber,
    date: p.date.toISOString().slice(0, 10),
    remarks: p.remarks,
    createdByName: p.createdBy.fullName,
    createdAt: p.createdAt.toISOString(),
  };
}

async function toDetail(p: PORow, companyId: string): Promise<PurchaseOrderDetail> {
  const paymentRows = await prisma.vendorPayment.findMany({
    where: { companyId, purchaseOrderId: p.id },
    orderBy: { date: "desc" },
    include: paymentInclude,
  });
  const paidPaise = paymentRows.reduce((s, x) => s + Number(x.amountPaise), 0);
  return {
    ...toListItem(p, new Map([[p.id, paidPaise]])),
    notes: p.notes,
    lineItems: p.lineItems.map((l) => ({
      id: l.id,
      material: l.material,
      materialId: l.materialId,
      category: l.category,
      quantity: Number(l.quantity),
      unit: l.unit,
      ratePaise: l.ratePaise,
      gstRateBps: l.gstRateBps,
      gstPaise: Number(l.gstPaise),
      amountPaise: Number(l.amountPaise),
      sortOrder: l.sortOrder,
    })),
    payments: paymentRows.map(toPaymentItem),
    createdByName: p.createdBy.fullName,
    approvedByName: p.approvedBy?.fullName ?? null,
    approvedAt: p.approvedAt ? p.approvedAt.toISOString() : null,
    revisedFromId: p.revisedFromId,
    revisedFromNumber: p.revisedFrom?.poNumber ?? null,
  };
}

/** Active company members — the "Created by" filter options (owners + PMs). */
export async function listMembers(): Promise<{ id: string; fullName: string }[]> {
  const user = await requireUser();
  return prisma.user.findMany({
    where: { companyId: user.company.id, status: "ACTIVE" },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
}

export async function listPurchaseOrders(filters: POFilters = {}): Promise<PurchaseOrderListItem[]> {
  const user = await requirePermission("purchase_orders.view");
  const material = materialFilterIntent(filters);
  const recordedIds = material?.kind === "name" ? await poIdsWithRecordedName(user.company.id, material.name) : null;
  const rows = await prisma.purchaseOrder.findMany({
    where: {
      companyId: user.company.id,
      // Scope: without purchase_orders.view_all, limited to POs on assigned projects.
      ...(hasPermission(user, "purchase_orders.view_all") ? {} : { project: { pmId: user.id } }),
      ...(filters.status && filters.status !== "ALL" ? { status: filters.status } : {}),
      ...(filters.projectId && filters.projectId !== "ALL" ? { projectId: filters.projectId } : {}),
      ...(filters.vendorId && filters.vendorId !== "ALL" ? { vendorId: filters.vendorId } : {}),
      // Material: identity via materialId (never the snapshot text), or the
      // recorded-name compatibility path. AND, so it composes with category.
      AND: [
        material?.kind === "id" ? { lineItems: { some: { materialId: material.materialId } } } : {},
        recordedIds ? { id: { in: recordedIds } } : {},
        filters.category && filters.category !== "ALL" ? { lineItems: { some: { category: filters.category } } } : {},
      ],
      ...(filters.createdById && filters.createdById !== "ALL" ? { createdById: filters.createdById } : {}),
      ...(filters.gst === "WITH" ? { gstPaise: { gt: 0 } } : {}),
      ...(filters.gst === "WITHOUT" ? { gstPaise: BigInt(0) } : {}),
      ...(filters.amountMinPaise != null || filters.amountMaxPaise != null
        ? {
            totalPaise: {
              ...(filters.amountMinPaise != null ? { gte: BigInt(Math.round(filters.amountMinPaise)) } : {}),
              ...(filters.amountMaxPaise != null ? { lte: BigInt(Math.round(filters.amountMaxPaise)) } : {}),
            },
          }
        : {}),
      ...(filters.dateFrom || filters.dateTo
        ? {
            purchaseDate: {
              ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
              ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
            },
          }
        : {}),
      ...(filters.search
        ? {
            OR: [
              { poNumber: { contains: filters.search, mode: "insensitive" } },
              { vendor: { businessName: { contains: filters.search, mode: "insensitive" } } },
              { lineItems: { some: { material: { contains: filters.search, mode: "insensitive" } } } },
              // ...and the CURRENT name of a linked Material, so a renamed
              // material is still found by what it is called today.
              { lineItems: { some: { materialRef: { name: { contains: filters.search, mode: "insensitive" } } } } },
            ],
          }
        : {}),
    },
    include: {
      vendor: { select: { businessName: true } },
      project: { select: { name: true, code: true } },
      createdBy: { select: { id: true, fullName: true } },
    },
    orderBy: poOrderBy(filters.sort),
  });
  const paid = paidByPO(await fetchRollupPayments(user.company.id));
  let items = rows.map((p) => toListItem(p, paid));
  if (filters.paymentStatus && filters.paymentStatus !== "ALL")
    items = items.filter((i) => i.paymentStatus === filters.paymentStatus);
  return items;
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrderDetail | null> {
  const user = await requirePermission("purchase_orders.view");
  const p = await prisma.purchaseOrder.findFirst({
    // Same scope as the list: view_all reaches any PO, otherwise only POs on the
    // caller's assigned projects (closes a direct-id access gap).
    where: {
      id,
      companyId: user.company.id,
      ...(hasPermission(user, "purchase_orders.view_all") ? {} : { project: { pmId: user.id } }),
    },
    include: poInclude,
  });
  return p ? toDetail(p, user.company.id) : null;
}

async function nextPoNumber(companyId: string): Promise<string> {
  const last = await prisma.purchaseOrder.findFirst({
    where: { companyId },
    orderBy: { poNumber: "desc" },
    select: { poNumber: true },
  });
  const n = Number(/PO-(\d+)/.exec(last?.poNumber ?? "")?.[1] ?? 0) + 1;
  return `PO-${String(n).padStart(4, "0")}`;
}

/**
 * Resolve every `materialId` a PO's lines reference, under the caller's company.
 *
 * Returns id -> master row. Rules:
 *  - an id that does not resolve in THIS company raises NOT_FOUND, whether it is
 *    foreign or fictional — the error must not confirm another tenant's ids;
 *  - a deactivated material raises MATERIAL_ARCHIVED, UNLESS it is already on
 *    this purchase order (`grandfathered`). A line that referenced a material
 *    which was archived later is history: editing the PO's date or notes must
 *    not be blocked by it, and must not silently demote the line to free text.
 */
async function resolveLineMaterials(
  user: SessionUser,
  lines: POLineItemInput[],
  grandfathered: Set<string> = new Set(),
): Promise<Map<string, MaterialRow>> {
  const ids = [...new Set(lines.map((l) => l.materialId).filter((x): x is string => !!x))];
  if (ids.length === 0) return new Map();
  const rows = await prisma.material.findMany({
    where: { id: { in: ids }, companyId: user.company.id },
  });
  if (rows.length !== ids.length) throw new Error("NOT_FOUND");
  for (const m of rows) {
    if (m.deletedAt !== null && !grandfathered.has(m.id)) throw new Error("MATERIAL_ARCHIVED");
  }
  return new Map(rows.map((m) => [m.id, m]));
}

function lineData(input: CreatePOInput, byId: Map<string, MaterialRow> = new Map()) {
  return input.lineItems.map((l, i) => ({
    // The SERVER decides the snapshot text. When a line names a material, the
    // master's name is written and any client-supplied `material` string is
    // discarded — the two can never disagree. Without a materialId the legacy
    // free-text path is unchanged.
    material: l.materialId ? byId.get(l.materialId)!.name : l.material,
    materialId: l.materialId ?? null,
    category: l.category ?? null,
    quantity: new Prisma.Decimal(l.quantity),
    unit: l.unit,
    ratePaise: l.ratePaise,
    gstRateBps: l.gstRateBps,
    gstPaise: BigInt(lineGstPaise(l.quantity, l.ratePaise, l.gstRateBps)),
    amountPaise: BigInt(lineAmountPaise(l.quantity, l.ratePaise)),
    sortOrder: i,
  }));
}

export async function createPurchaseOrder(input: CreatePOInput): Promise<PurchaseOrderDetail> {
  const user = await requirePermission("purchase_orders.create");
  createPOInputSchema.parse(input);
  await assertProjectAccess(user, input.projectId);
  await assertVendorAccess(user, input.vendorId);
  // A NEW order may only name live materials — nothing is grandfathered here.
  // Note there is deliberately NO check that the vendor supplies them: the
  // vendor mapping is a convenience catalogue, never an ordering constraint.
  const materialsById = await resolveLineMaterials(user, input.lineItems);
  const finalize = !(await approvalRequired(user.company.id));
  const totals = poTotals(input.lineItems);
  const created = await prisma.purchaseOrder.create({
    data: {
      companyId: user.company.id,
      vendorId: input.vendorId,
      projectId: input.projectId,
      poNumber: await nextPoNumber(user.company.id),
      status: finalize ? "APPROVED" : "DRAFT",
      invoiceNumber: input.invoiceNumber ?? null,
      purchaseDate: new Date(input.purchaseDate),
      expectedDelivery: input.expectedDelivery ? new Date(input.expectedDelivery) : null,
      notes: input.notes ?? null,
      subtotalPaise: BigInt(totals.subtotalPaise),
      gstPaise: BigInt(totals.gstPaise),
      totalPaise: BigInt(totals.totalPaise),
      createdById: user.id,
      approvedById: finalize ? user.id : null,
      approvedAt: finalize ? new Date() : null,
      lineItems: { create: lineData(input, materialsById) },
    },
    select: { id: true },
  });
  return (await getPurchaseOrder(created.id))!;
}

export async function updatePurchaseOrder(id: string, input: CreatePOInput): Promise<PurchaseOrderDetail> {
  const user = await requirePermission("purchase_orders.edit");
  createPOInputSchema.parse(input);
  const existing = await prisma.purchaseOrder.findFirst({
    where: { id, companyId: user.company.id },
    // The existing lines' materialIds are what may be kept despite being
    // archived — see resolveLineMaterials.
    select: { status: true, projectId: true, lineItems: { select: { materialId: true } } },
  });
  if (!existing) throw new Error("NOT_FOUND");
  await assertProjectAccess(user, existing.projectId);
  await assertProjectAccess(user, input.projectId);
  await assertVendorAccess(user, input.vendorId);
  // Drafts are editable with purchase_orders.edit + project access; editing a
  // SUBMITTED/APPROVED PO additionally requires the broad purchase_orders.edit_all.
  if (existing.status !== "DRAFT" && !hasPermission(user, "purchase_orders.edit_all")) {
    throw new Error("IMMUTABLE");
  }
  const grandfathered = new Set(
    existing.lineItems.map((l) => l.materialId).filter((x): x is string => !!x),
  );
  const materialsById = await resolveLineMaterials(user, input.lineItems, grandfathered);
  const totals = poTotals(input.lineItems);
  await prisma.$transaction([
    prisma.pOLineItem.deleteMany({ where: { purchaseOrderId: id } }),
    prisma.purchaseOrder.update({
      where: { id },
      data: {
        vendorId: input.vendorId,
        projectId: input.projectId,
        purchaseDate: new Date(input.purchaseDate),
        expectedDelivery: input.expectedDelivery ? new Date(input.expectedDelivery) : null,
        invoiceNumber: input.invoiceNumber ?? null,
        notes: input.notes ?? null,
        subtotalPaise: BigInt(totals.subtotalPaise),
        gstPaise: BigInt(totals.gstPaise),
        totalPaise: BigInt(totals.totalPaise),
        // Lines are deleted and recreated, so materialId must be carried through
        // explicitly or an ordinary edit would silently strip every canonical
        // material reference off the order.
        lineItems: { create: lineData(input, materialsById) },
      },
    }),
  ]);
  return (await getPurchaseOrder(id))!;
}

export async function submitPurchaseOrder(id: string): Promise<PurchaseOrderListItem> {
  // Submitting a draft for approval is an edit action, scoped to project access.
  const user = await requirePermission("purchase_orders.edit");
  const existing = await prisma.purchaseOrder.findFirst({
    where: { id, companyId: user.company.id },
    select: { projectId: true },
  });
  if (!existing) throw new Error("NOT_FOUND");
  await assertProjectAccess(user, existing.projectId);
  const po = await prisma.purchaseOrder.update({
    where: { id, companyId: user.company.id },
    data: { status: "SUBMITTED" },
    include: { vendor: { select: { businessName: true } }, project: { select: { name: true, code: true } } },
  });
  return toListItem(po, paidByPO(await fetchRollupPayments(user.company.id)));
}

export async function approvePurchaseOrder(id: string): Promise<PurchaseOrderListItem> {
  // Dedicated approval authority — never the generic edit permission.
  const user = await requirePermission("purchase_orders.approve");
  const po = await prisma.purchaseOrder.update({
    where: { id, companyId: user.company.id },
    data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() },
    include: { vendor: { select: { businessName: true } }, project: { select: { name: true, code: true } } },
  });
  return toListItem(po, paidByPO(await fetchRollupPayments(user.company.id)));
}

async function clonePO(id: string, opts: { linkRevision: boolean }): Promise<PurchaseOrderDetail> {
  // Revise/duplicate both create a NEW draft PO → gated by create + project access.
  const user = await requirePermission("purchase_orders.create");
  const src = await prisma.purchaseOrder.findFirstOrThrow({ where: { id, companyId: user.company.id }, include: { lineItems: true } });
  await assertProjectAccess(user, src.projectId);

  // A DUPLICATE is a new order, so it may not reference a material the company
  // has since archived: that line keeps its name and figures but loses the id,
  // and the editor shows it as not linked — asking for a current material
  // rather than quietly re-ordering a retired one. (Carrying the id would also
  // grandfather it on every later save of the copy.) A REVISE amends the same
  // order, so it keeps what was originally ordered, archived or not.
  const archivedIds = new Set<string>();
  if (!opts.linkRevision) {
    const ids = [...new Set(src.lineItems.map((l) => l.materialId).filter((x): x is string => !!x))];
    if (ids.length > 0) {
      const rows = await prisma.material.findMany({
        where: { id: { in: ids }, companyId: user.company.id, deletedAt: { not: null } },
        select: { id: true },
      });
      for (const r of rows) archivedIds.add(r.id);
    }
  }

  const created = await prisma.purchaseOrder.create({
    data: {
      companyId: user.company.id,
      vendorId: src.vendorId,
      projectId: src.projectId,
      poNumber: await nextPoNumber(user.company.id),
      status: "DRAFT",
      purchaseDate: opts.linkRevision ? src.purchaseDate : new Date(),
      expectedDelivery: opts.linkRevision ? src.expectedDelivery : null,
      notes: src.notes,
      subtotalPaise: src.subtotalPaise,
      gstPaise: src.gstPaise,
      totalPaise: src.totalPaise,
      createdById: user.id,
      revisedFromId: opts.linkRevision ? src.id : null,
      lineItems: {
        create: src.lineItems.map((l) => ({
          material: l.material,
          // Carried over, except an archived material on a duplicate (above).
          materialId: l.materialId && archivedIds.has(l.materialId) ? null : l.materialId,
          category: l.category,
          quantity: l.quantity,
          unit: l.unit,
          ratePaise: l.ratePaise,
          gstRateBps: l.gstRateBps,
          gstPaise: l.gstPaise,
          amountPaise: l.amountPaise,
          sortOrder: l.sortOrder,
        })),
      },
    },
    select: { id: true },
  });
  return (await getPurchaseOrder(created.id))!;
}

export async function revisePurchaseOrder(id: string): Promise<PurchaseOrderDetail> {
  return clonePO(id, { linkRevision: true });
}

export async function duplicatePurchaseOrder(id: string): Promise<PurchaseOrderDetail> {
  return clonePO(id, { linkRevision: false });
}

/**
 * Permanently delete a PO (owner-only, any status). Runs in a transaction:
 * line items and goods receipts cascade at the DB level; linked payments keep
 * their record with the PO link nulled (SetNull); revisions unlink (SetNull).
 * Vendor/project/budget/dashboard aggregates all read live from PO rows, so
 * removing the row updates them immediately. A deletion event is recorded
 * (the activity log is append-only).
 */
export async function deletePurchaseOrder(id: string): Promise<void> {
  const user = await requirePermission("purchase_orders.delete");
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, companyId: user.company.id },
    select: { id: true, poNumber: true, status: true, project: { select: { pmId: true } } },
  });
  if (!po) throw new Error("NOT_FOUND");
  // Ownership scope: broad edit_all deletes any; otherwise only assigned-project POs.
  if (!hasPermission(user, "purchase_orders.edit_all") && po.project.pmId !== user.id) {
    throw new Error("FORBIDDEN");
  }
  // An order that has been paid against is no longer just a document. Deleting
  // it takes the ordered value out of the budget and out of every report while
  // the payments survive with their PO link nulled (schema: SetNull) — so the
  // money stays but what it bought does not, and "still owed" stops meaning
  // anything. Payments have no reversal yet, so the order has to stand.
  // See features/governance/delete-policy.ts.
  const paidAgainst = await prisma.vendorPayment.count({
    where: { companyId: user.company.id, purchaseOrderId: po.id },
  });
  if (paidAgainst > 0) throw new Error("PO_HAS_PAYMENTS");
  await prisma.$transaction([
    prisma.purchaseOrder.delete({ where: { id, companyId: user.company.id } }),
    prisma.activityLog.create({
      data: {
        companyId: user.company.id,
        actorId: user.id,
        action: "po.deleted",
        entityType: "purchase_order",
        entityId: po.id,
        summary: `Permanently deleted ${po.poNumber}`,
        meta: { status: po.status },
      },
    }),
  ]);
}

export async function pendingApprovalCount(): Promise<number> {
  const user = await requirePermission("purchase_orders.view");
  return prisma.purchaseOrder.count({ where: { companyId: user.company.id, status: "SUBMITTED" } });
}

/* ── Payments ────────────────────────────────────────────────────────── */

export async function listPayments(filters: PaymentFilters = {}): Promise<VendorPaymentItem[]> {
  const user = await requirePermission("payments.view");
  const rows = await prisma.vendorPayment.findMany({
    where: {
      companyId: user.company.id,
      // Scope: without payments.view_all, limited to the caller's projects.
      ...(hasPermission(user, "payments.view_all") ? {} : { project: { pmId: user.id } }),
      ...(filters.vendorId && filters.vendorId !== "ALL" ? { vendorId: filters.vendorId } : {}),
      ...(filters.projectId && filters.projectId !== "ALL" ? { projectId: filters.projectId } : {}),
      ...(filters.purchaseOrderId ? { purchaseOrderId: filters.purchaseOrderId } : {}),
      ...(filters.mode && filters.mode !== "ALL" ? { paymentMode: filters.mode } : {}),
      ...(filters.dateFrom ? { date: { gte: new Date(filters.dateFrom) } } : {}),
      ...(filters.dateTo ? { AND: [{ date: { lte: new Date(filters.dateTo) } }] } : {}),
    },
    orderBy: { date: "desc" },
    include: paymentInclude,
  });
  return rows.map(toPaymentItem);
}

export async function createPayment(input: CreatePaymentInput): Promise<VendorPaymentItem> {
  const user = await requirePermission("payments.create");
  createPaymentInputSchema.parse(input);
  await assertProjectAccess(user, input.projectId);
  await assertVendorAccess(user, input.vendorId);
  if (input.purchaseOrderId) await assertPurchaseOrderAccess(user, input.purchaseOrderId);

  // Idempotency: a repeated submission (double-click / retry) carrying the same
  // clientUuid returns the original payment instead of recording a duplicate.
  const findByClientUuid = () =>
    input.clientUuid
      ? prisma.vendorPayment.findFirst({
          where: { clientUuid: input.clientUuid, companyId: user.company.id },
          include: paymentInclude,
        })
      : Promise.resolve(null);

  const prior = await findByClientUuid();
  if (prior) return toPaymentItem(prior);

  try {
    const row = await prisma.vendorPayment.create({
      data: {
        companyId: user.company.id,
        vendorId: input.vendorId,
        projectId: input.projectId,
        purchaseOrderId: input.purchaseOrderId ?? null,
        amountPaise: BigInt(input.amountPaise),
        paymentMode: input.paymentMode,
        referenceNumber: input.referenceNumber ?? null,
        date: new Date(input.date),
        remarks: input.remarks ?? null,
        clientUuid: input.clientUuid ?? null,
        createdById: user.id,
      },
      include: paymentInclude,
    });
    await prisma.activityLog.create({
      data: {
        companyId: user.company.id,
        actorId: user.id,
        action: "payment.recorded",
        entityType: "vendor_payment",
        entityId: row.id,
        summary: `Recorded a payment to ${row.vendor.businessName}`,
        meta: { vendorId: input.vendorId, projectId: input.projectId, amountPaise: input.amountPaise },
      },
    });
    return toPaymentItem(row);
  } catch (err) {
    // Race: a concurrent request with the same clientUuid won the unique index.
    if (input.clientUuid && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await findByClientUuid();
      if (raced) return toPaymentItem(raced);
    }
    throw err;
  }
}

/**
 * Vendor payments are immutable once recorded.
 *
 * This used to hard-delete the row. That quietly destroyed cash movement: the
 * Payments centre, the Cash movement report and every "paid against orders"
 * figure read `vendorPayment`, so removing one made money that had genuinely
 * left the company disappear from the record of it — with only an activity-log
 * line left behind, and no way to tell an erroneous entry from a real payment
 * that was erased.
 *
 * Contractor instruments solve this with reversal: the row stays, marked
 * reversed, excluded from active totals, reason recorded. Vendor payments have
 * no such concept yet — a deliberate, reported gap — so until they do, the safe
 * answer is to refuse rather than to destroy. Correction happens where the
 * payment was recorded.
 *
 * Kept as a function, rather than removed, so a caller gets this explanation
 * instead of a missing export.
 */
export async function deletePayment(id: string): Promise<never> {
  // Still permission-gated and still company-scoped: an unauthorised caller
  // learns nothing about whether the payment exists.
  const user = await requirePermission("payments.delete");
  const row = await prisma.vendorPayment.findFirst({
    where: { id, companyId: user.company.id },
    select: { id: true, project: { select: { pmId: true } } },
  });
  if (!row) throw new Error("NOT_FOUND");
  if (!hasPermission(user, "payments.view_all") && row.project.pmId !== user.id) {
    throw new Error("FORBIDDEN");
  }
  throw new Error("VENDOR_PAYMENT_IMMUTABLE");
}

/* ── Project-aware views ─────────────────────────────────────────────── */

export async function getProjectProcurement(projectId: string): Promise<ProjectProcurement> {
  const user = await requireUser();
  await assertProjectAccess(user, projectId);
  const [project, pos, payments, approval, poRows, paymentRows, vendors] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { procurementBudgetPaise: true } }),
    fetchRollupPOs(user.company.id),
    fetchRollupPayments(user.company.id),
    approvalRequired(user.company.id),
    prisma.purchaseOrder.findMany({
      where: { companyId: user.company.id, projectId },
      orderBy: { purchaseDate: "desc" },
      include: { vendor: { select: { businessName: true } }, project: { select: { name: true, code: true } } },
    }),
    prisma.vendorPayment.findMany({
      where: { companyId: user.company.id, projectId },
      orderBy: { date: "desc" },
      include: paymentInclude,
    }),
    prisma.vendor.findMany({ where: { companyId: user.company.id }, select: { id: true, businessName: true, status: true } }),
  ]);
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const paid = paidByPO(payments);
  return {
    summary: projectProcurementSummary(
      project.procurementBudgetPaise == null ? null : Number(project.procurementBudgetPaise),
      pos,
      payments,
      projectId,
      approval,
    ),
    vendors: projectVendorRollups(pos, payments, projectId, approval).map((r) => ({
      ...r,
      vendor: {
        id: r.id,
        name: vendorById.get(r.id)?.businessName ?? "Unknown",
        status: vendorById.get(r.id)?.status ?? "ACTIVE",
      },
    })),
    purchaseOrders: poRows.map((p) => toListItem(p, paid)),
    payments: paymentRows.map(toPaymentItem),
  };
}

export async function vendorAging(vendorId: string, projectId?: string): Promise<AgingBuckets> {
  const user = await requirePermission("vendors.view");
  const [pos, payments, approval, poNumbers] = await Promise.all([
    fetchRollupPOs(user.company.id),
    fetchRollupPayments(user.company.id),
    approvalRequired(user.company.id),
    prisma.purchaseOrder.findMany({ where: { companyId: user.company.id, vendorId }, select: { id: true, poNumber: true } }),
  ]);
  const buckets = agingBuckets(pos, payments, vendorId, approval, new Date().toISOString().slice(0, 10), projectId);
  const byId = new Map(poNumbers.map((p) => [p.id, p.poNumber]));
  buckets.rows.forEach((r) => (r.poNumber = byId.get(r.poId)));
  return buckets;
}
