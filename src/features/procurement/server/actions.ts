"use server";

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/current-user";
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
import { DEFAULT_MATERIAL_CATEGORIES } from "../constants";
import { poDeleteAction } from "../deletion";
import type {
  CreatePaymentInput,
  CreatePOInput,
  CreateVendorInput,
  PaymentFilters,
  POFilters,
  POSort,
  ProjectProcurement,
  PurchaseOrderDetail,
  PurchaseOrderListItem,
  UpdateVendorInput,
  Vendor,
  VendorDetail,
  VendorFilters,
  VendorPaymentItem,
  VendorStatus,
} from "../types";
import type { AgingBuckets } from "../calc";

function assertOwner(user: SessionUser) {
  if (user.role !== "OWNER") throw new Error("FORBIDDEN");
}
async function assertProjectAccess(user: SessionUser, projectId: string) {
  const p = await prisma.project.findFirst({
    where: {
      id: projectId,
      companyId: user.company.id,
      deletedAt: null,
      ...(user.role !== "OWNER" ? { pmId: user.id } : {}),
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
      lineItems: { select: { material: true } },
    },
  });
  return rows.map((p) => ({
    id: p.id,
    vendorId: p.vendorId,
    projectId: p.projectId,
    status: p.status,
    totalPaise: Number(p.totalPaise),
    purchaseDate: p.purchaseDate.toISOString().slice(0, 10),
    materials: [...new Set(p.lineItems.map((l) => l.material))],
  }));
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

type VendorRow = Prisma.VendorGetPayload<Record<string, never>>;

function toVendor(
  v: VendorRow,
  pos: POForRollup[],
  payments: PaymentForRollup[],
  favoriteIds: Set<string>,
  approval: boolean,
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
  const [pos, payments, favorites, approval] = await Promise.all([
    fetchRollupPOs(user.company.id),
    fetchRollupPayments(user.company.id),
    prisma.vendorFavorite.findMany({ where: { userId: user.id }, select: { vendorId: true } }),
    approvalRequired(user.company.id),
  ]);
  return { pos, payments, favoriteIds: new Set(favorites.map((f) => f.vendorId)), approval };
}

export async function listVendors(filters: VendorFilters = {}): Promise<Vendor[]> {
  const user = await requireUser();
  const [rows, ctx] = await Promise.all([
    prisma.vendor.findMany({
      where: {
        companyId: user.company.id,
        ...(filters.status && filters.status !== "ALL" ? { status: filters.status } : {}),
        ...(filters.material && filters.material !== "ALL" ? { materialsSupplied: { has: filters.material } } : {}),
        ...(filters.favoritesOnly ? { favorites: { some: { userId: user.id } } } : {}),
        ...(filters.search
          ? {
              OR: [
                { businessName: { contains: filters.search, mode: "insensitive" } },
                { contactPerson: { contains: filters.search, mode: "insensitive" } },
                { materialsSupplied: { has: filters.search } },
              ],
            }
          : {}),
      },
      orderBy: { businessName: "asc" },
    }),
    vendorContext(user),
  ]);
  return rows.map((v) => toVendor(v, ctx.pos, ctx.payments, ctx.favoriteIds, ctx.approval));
}

export async function getVendor(id: string): Promise<VendorDetail | null> {
  const user = await requireUser();
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
    ...toVendor(v, ctx.pos, ctx.payments, ctx.favoriteIds, ctx.approval),
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
  const user = await requireUser();
  assertOwner(user);
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
      materialsSupplied: input.materialsSupplied ?? [],
      paymentTerms: input.paymentTerms ?? null,
      notes: input.notes ?? null,
    },
  });
  const ctx = await vendorContext(user);
  return toVendor(v, ctx.pos, ctx.payments, ctx.favoriteIds, ctx.approval);
}

export async function updateVendor(id: string, patch: UpdateVendorInput): Promise<Vendor> {
  const user = await requireUser();
  assertOwner(user);
  vendorPatchSchema.parse(patch);
  const v = await prisma.vendor.update({ where: { id, companyId: user.company.id }, data: patch });
  await prisma.activityLog.create({
    data: {
      companyId: user.company.id,
      actorId: user.id,
      action: "vendor.updated",
      entityType: "vendor",
      entityId: v.id,
      summary: `Updated vendor ${v.businessName}`,
      meta: { fields: Object.keys(patch) },
    },
  });
  const ctx = await vendorContext(user);
  return toVendor(v, ctx.pos, ctx.payments, ctx.favoriteIds, ctx.approval);
}

export async function setVendorStatus(id: string, status: VendorStatus): Promise<Vendor> {
  return updateVendor(id, { status });
}

export async function toggleVendorFavorite(id: string): Promise<boolean> {
  const user = await requireUser();
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

export async function listMaterials(): Promise<string[]> {
  const user = await requireUser();
  const rows = await prisma.vendor.findMany({ where: { companyId: user.company.id }, select: { materialsSupplied: true } });
  return [...new Set(rows.flatMap((r) => r.materialsSupplied))].sort();
}

export async function addVendorDocument(
  vendorId: string,
  doc: { filename: string; sizeBytes: number; mimeType: string },
): Promise<VendorDetail> {
  const user = await requireUser();
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
  const user = await requireUser();
  await prisma.vendorDocument.delete({ where: { id: docId, companyId: user.company.id } });
  return (await getVendor(vendorId))!;
}

/* ── Material category presets (Company.settings) ────────────────────── */

export async function listMaterialCategories(): Promise<string[]> {
  const user = await requireUser();
  const c = await prisma.company.findUnique({ where: { id: user.company.id }, select: { settings: true } });
  const stored = (c?.settings as { materialCategories?: string[] } | null)?.materialCategories;
  if (Array.isArray(stored) && stored.length) return stored;
  return setMaterialCategories([...DEFAULT_MATERIAL_CATEGORIES]);
}

export async function setMaterialCategories(categories: string[]): Promise<string[]> {
  const user = await requireUser();
  const clean = [...new Set(categories.map((c) => c.trim()).filter(Boolean))];
  const c = await prisma.company.findUniqueOrThrow({ where: { id: user.company.id }, select: { settings: true } });
  await prisma.company.update({
    where: { id: user.company.id },
    data: { settings: { ...(c.settings as object), materialCategories: clean } },
  });
  return clean;
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
  archivedAt?: Date | null;
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
    archivedAt: p.archivedAt ? p.archivedAt.toISOString() : null,
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
  const user = await requireUser();
  const rows = await prisma.purchaseOrder.findMany({
    where: {
      companyId: user.company.id,
      // Archived POs are hidden unless explicitly requested.
      ...(filters.archived === "ARCHIVED" ? { archivedAt: { not: null } } : { archivedAt: null }),
      ...(user.role !== "OWNER" ? { project: { pmId: user.id } } : {}),
      ...(filters.status && filters.status !== "ALL" ? { status: filters.status } : {}),
      ...(filters.projectId && filters.projectId !== "ALL" ? { projectId: filters.projectId } : {}),
      ...(filters.vendorId && filters.vendorId !== "ALL" ? { vendorId: filters.vendorId } : {}),
      ...(filters.material && filters.material !== "ALL" ? { lineItems: { some: { material: filters.material } } } : {}),
      ...(filters.category && filters.category !== "ALL" ? { lineItems: { some: { category: filters.category } } } : {}),
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
  const user = await requireUser();
  const p = await prisma.purchaseOrder.findFirst({
    where: { id, companyId: user.company.id },
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

function lineData(input: CreatePOInput) {
  return input.lineItems.map((l, i) => ({
    material: l.material,
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
  const user = await requireUser();
  createPOInputSchema.parse(input);
  await assertProjectAccess(user, input.projectId);
  await assertVendorAccess(user, input.vendorId);
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
      lineItems: { create: lineData(input) },
    },
    select: { id: true },
  });
  return (await getPurchaseOrder(created.id))!;
}

export async function updatePurchaseOrder(id: string, input: CreatePOInput): Promise<PurchaseOrderDetail> {
  const user = await requireUser();
  createPOInputSchema.parse(input);
  const existing = await prisma.purchaseOrder.findFirst({ where: { id, companyId: user.company.id }, select: { status: true, projectId: true } });
  if (!existing) throw new Error("NOT_FOUND");
  await assertProjectAccess(user, existing.projectId);
  await assertProjectAccess(user, input.projectId);
  await assertVendorAccess(user, input.vendorId);
  if (existing.status !== "DRAFT") throw new Error("IMMUTABLE");
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
        lineItems: { create: lineData(input) },
      },
    }),
  ]);
  return (await getPurchaseOrder(id))!;
}

export async function submitPurchaseOrder(id: string): Promise<PurchaseOrderListItem> {
  const user = await requireUser();
  const po = await prisma.purchaseOrder.update({
    where: { id, companyId: user.company.id },
    data: { status: "SUBMITTED" },
    include: { vendor: { select: { businessName: true } }, project: { select: { name: true, code: true } } },
  });
  return toListItem(po, paidByPO(await fetchRollupPayments(user.company.id)));
}

export async function approvePurchaseOrder(id: string): Promise<PurchaseOrderListItem> {
  const user = await requireUser();
  assertOwner(user);
  const po = await prisma.purchaseOrder.update({
    where: { id, companyId: user.company.id },
    data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() },
    include: { vendor: { select: { businessName: true } }, project: { select: { name: true, code: true } } },
  });
  return toListItem(po, paidByPO(await fetchRollupPayments(user.company.id)));
}

async function clonePO(id: string, opts: { linkRevision: boolean }): Promise<PurchaseOrderDetail> {
  const user = await requireUser();
  const src = await prisma.purchaseOrder.findFirstOrThrow({ where: { id, companyId: user.company.id }, include: { lineItems: true } });
  await assertProjectAccess(user, src.projectId);
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

export async function deletePurchaseOrder(id: string): Promise<void> {
  const user = await requireUser();
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, companyId: user.company.id },
    select: { id: true, poNumber: true, status: true, createdById: true },
  });
  if (!po) throw new Error("NOT_FOUND");
  const action = poDeleteAction(po.status, {
    isOwner: user.role === "OWNER",
    isCreator: po.createdById === user.id,
  });
  if (action !== "DELETE") throw new Error("FORBIDDEN");
  await prisma.purchaseOrder.delete({ where: { id, companyId: user.company.id } });
  await prisma.activityLog.create({
    data: {
      companyId: user.company.id,
      actorId: user.id,
      action: "po.deleted",
      entityType: "purchase_order",
      entityId: po.id,
      summary: `Deleted ${po.poNumber} (${po.status.toLowerCase()})`,
    },
  });
}

/** Archive an APPROVED PO (never hard-deleted). Owner-only, audited. */
export async function archivePurchaseOrder(id: string): Promise<void> {
  const user = await requireUser();
  assertOwner(user);
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, companyId: user.company.id },
    select: { id: true, poNumber: true, archivedAt: true },
  });
  if (!po) throw new Error("NOT_FOUND");
  if (po.archivedAt) return; // already archived — idempotent
  await prisma.purchaseOrder.update({
    where: { id, companyId: user.company.id },
    data: { archivedAt: new Date() },
  });
  await prisma.activityLog.create({
    data: {
      companyId: user.company.id,
      actorId: user.id,
      action: "po.archived",
      entityType: "purchase_order",
      entityId: po.id,
      summary: `Archived ${po.poNumber}`,
    },
  });
}

/** Restore an archived PO. Owner-only, audited. */
export async function unarchivePurchaseOrder(id: string): Promise<void> {
  const user = await requireUser();
  assertOwner(user);
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, companyId: user.company.id },
    select: { id: true, poNumber: true, archivedAt: true },
  });
  if (!po) throw new Error("NOT_FOUND");
  if (!po.archivedAt) return;
  await prisma.purchaseOrder.update({
    where: { id, companyId: user.company.id },
    data: { archivedAt: null },
  });
  await prisma.activityLog.create({
    data: {
      companyId: user.company.id,
      actorId: user.id,
      action: "po.unarchived",
      entityType: "purchase_order",
      entityId: po.id,
      summary: `Restored ${po.poNumber} from archive`,
    },
  });
}

export async function pendingApprovalCount(): Promise<number> {
  const user = await requireUser();
  return prisma.purchaseOrder.count({ where: { companyId: user.company.id, status: "SUBMITTED" } });
}

/* ── Payments ────────────────────────────────────────────────────────── */

export async function listPayments(filters: PaymentFilters = {}): Promise<VendorPaymentItem[]> {
  const user = await requireUser();
  const rows = await prisma.vendorPayment.findMany({
    where: {
      companyId: user.company.id,
      ...(user.role !== "OWNER" ? { project: { pmId: user.id } } : {}),
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
  const user = await requireUser();
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

export async function deletePayment(id: string): Promise<void> {
  const user = await requireUser();
  assertOwner(user);
  const row = await prisma.vendorPayment.delete({ where: { id, companyId: user.company.id } });
  await prisma.activityLog.create({
    data: {
      companyId: user.company.id,
      actorId: user.id,
      action: "payment.deleted",
      entityType: "vendor_payment",
      entityId: id,
      summary: "Deleted a vendor payment",
      meta: { vendorId: row.vendorId, projectId: row.projectId, amountPaise: Number(row.amountPaise) },
    },
  });
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
  const user = await requireUser();
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
