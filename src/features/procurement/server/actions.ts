"use server";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/current-user";
import type { SessionUser } from "@/lib/auth/types";
import { Prisma } from "@/generated/prisma";
import type {
  CreatePOInput,
  CreateVendorInput,
  POFilters,
  PurchaseOrderDetail,
  PurchaseOrderListItem,
  UpdateVendorInput,
  Vendor,
  VendorDetail,
  VendorFilters,
  VendorStatus,
} from "../types";

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
async function approvalRequired(companyId: string): Promise<boolean> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { settings: true } });
  return (c?.settings as { poApprovalRequired?: boolean } | null)?.poApprovalRequired ?? false;
}

/* ── Vendors ─────────────────────────────────────────────────────────── */

async function vendorRollup(user: SessionUser, v: { id: string } & Record<string, unknown>): Promise<Vendor> {
  const agg = await prisma.purchaseOrder.aggregate({
    where: { companyId: user.company.id, vendorId: v.id, status: { not: "DRAFT" } },
    _sum: { totalPaise: true },
    _count: true,
  });
  const fav = await prisma.vendorFavorite.findUnique({
    where: { userId_vendorId: { userId: user.id, vendorId: v.id } },
  });
  return {
    id: v.id,
    businessName: v.businessName as string,
    contactPerson: (v.contactPerson as string) ?? null,
    phone: (v.phone as string) ?? null,
    email: (v.email as string) ?? null,
    gstin: (v.gstin as string) ?? null,
    address: (v.address as string) ?? null,
    materialsSupplied: (v.materialsSupplied as string[]) ?? [],
    paymentTerms: (v.paymentTerms as string) ?? null,
    status: v.status as VendorStatus,
    notes: (v.notes as string) ?? null,
    isFavorite: !!fav,
    totalPurchasedPaise: Number(agg._sum.totalPaise ?? 0),
    poCount: agg._count,
  };
}

export async function listVendors(filters: VendorFilters = {}): Promise<Vendor[]> {
  const user = await requireUser();
  const rows = await prisma.vendor.findMany({
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
  });
  return Promise.all(rows.map((v) => vendorRollup(user, v)));
}

export async function getVendor(id: string): Promise<VendorDetail | null> {
  const user = await requireUser();
  const v = await prisma.vendor.findFirst({ where: { id, companyId: user.company.id } });
  if (!v) return null;
  const pos = await prisma.purchaseOrder.findMany({
    where: { companyId: user.company.id, vendorId: id },
    orderBy: { purchaseDate: "desc" },
    include: { project: { select: { name: true, code: true } } },
  });
  return {
    ...(await vendorRollup(user, v)),
    purchaseHistory: pos.map((p) => ({
      id: p.id,
      poNumber: p.poNumber,
      status: p.status,
      purchaseDate: p.purchaseDate.toISOString().slice(0, 10),
      totalPaise: Number(p.totalPaise),
      invoiceNumber: p.invoiceNumber,
      vendor: { id, name: v.businessName },
      project: { id: p.projectId, name: p.project.name, code: p.project.code },
      createdAt: p.createdAt.toISOString(),
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
      address: input.address ?? null,
      materialsSupplied: input.materialsSupplied ?? [],
      paymentTerms: input.paymentTerms ?? null,
      notes: input.notes ?? null,
    },
  });
  return vendorRollup(user, v);
}

export async function updateVendor(id: string, patch: UpdateVendorInput): Promise<Vendor> {
  const user = await requireUser();
  assertOwner(user);
  const v = await prisma.vendor.update({ where: { id, companyId: user.company.id }, data: patch });
  return vendorRollup(user, v);
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

/* ── Purchase orders ─────────────────────────────────────────────────── */

const poInclude = {
  vendor: { select: { businessName: true } },
  project: { select: { name: true, code: true } },
  createdBy: { select: { fullName: true } },
  approvedBy: { select: { fullName: true } },
  revisedFrom: { select: { poNumber: true } },
  lineItems: { orderBy: { sortOrder: "asc" } },
} satisfies Prisma.PurchaseOrderInclude;

type PORow = Prisma.PurchaseOrderGetPayload<{ include: typeof poInclude }>;

function toListItem(p: {
  id: string; poNumber: string; status: "DRAFT" | "SUBMITTED" | "APPROVED"; purchaseDate: Date;
  totalPaise: bigint; invoiceNumber: string | null; vendorId: string; projectId: string; createdAt: Date;
  vendor: { businessName: string }; project: { name: string; code: string };
}): PurchaseOrderListItem {
  return {
    id: p.id,
    poNumber: p.poNumber,
    status: p.status,
    purchaseDate: p.purchaseDate.toISOString().slice(0, 10),
    totalPaise: Number(p.totalPaise),
    invoiceNumber: p.invoiceNumber,
    vendor: { id: p.vendorId, name: p.vendor.businessName },
    project: { id: p.projectId, name: p.project.name, code: p.project.code },
    createdAt: p.createdAt.toISOString(),
  };
}

function toDetail(p: PORow): PurchaseOrderDetail {
  return {
    ...toListItem(p),
    notes: p.notes,
    lineItems: p.lineItems.map((l) => ({
      id: l.id,
      material: l.material,
      quantity: Number(l.quantity),
      unit: l.unit,
      ratePaise: l.ratePaise,
      amountPaise: Number(l.amountPaise),
      sortOrder: l.sortOrder,
    })),
    createdByName: p.createdBy.fullName,
    approvedByName: p.approvedBy?.fullName ?? null,
    approvedAt: p.approvedAt ? p.approvedAt.toISOString() : null,
    revisedFromId: p.revisedFromId,
    revisedFromNumber: p.revisedFrom?.poNumber ?? null,
  };
}

export async function listPurchaseOrders(filters: POFilters = {}): Promise<PurchaseOrderListItem[]> {
  const user = await requireUser();
  const rows = await prisma.purchaseOrder.findMany({
    where: {
      companyId: user.company.id,
      ...(user.role !== "OWNER" ? { project: { pmId: user.id } } : {}),
      ...(filters.status && filters.status !== "ALL" ? { status: filters.status } : {}),
      ...(filters.projectId && filters.projectId !== "ALL" ? { projectId: filters.projectId } : {}),
      ...(filters.vendorId && filters.vendorId !== "ALL" ? { vendorId: filters.vendorId } : {}),
      ...(filters.search
        ? {
            OR: [
              { poNumber: { contains: filters.search, mode: "insensitive" } },
              { vendor: { businessName: { contains: filters.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: { vendor: { select: { businessName: true } }, project: { select: { name: true, code: true } } },
    orderBy: { purchaseDate: "desc" },
  });
  return rows.map(toListItem);
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrderDetail | null> {
  const user = await requireUser();
  const p = await prisma.purchaseOrder.findFirst({
    where: { id, companyId: user.company.id },
    include: poInclude,
  });
  return p ? toDetail(p) : null;
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
    quantity: new Prisma.Decimal(l.quantity),
    unit: l.unit,
    ratePaise: l.ratePaise,
    amountPaise: BigInt(Math.round(l.quantity * l.ratePaise)),
    sortOrder: i,
  }));
}

export async function createPurchaseOrder(input: CreatePOInput): Promise<PurchaseOrderDetail> {
  const user = await requireUser();
  await assertProjectAccess(user, input.projectId);
  const finalize = !(await approvalRequired(user.company.id));
  const lines = lineData(input);
  const total = lines.reduce((s, l) => s + l.amountPaise, BigInt(0));
  const created = await prisma.purchaseOrder.create({
    data: {
      companyId: user.company.id,
      vendorId: input.vendorId,
      projectId: input.projectId,
      poNumber: await nextPoNumber(user.company.id),
      status: finalize ? "APPROVED" : "DRAFT",
      invoiceNumber: input.invoiceNumber ?? null,
      purchaseDate: new Date(input.purchaseDate),
      notes: input.notes ?? null,
      totalPaise: total,
      createdById: user.id,
      approvedById: finalize ? user.id : null,
      approvedAt: finalize ? new Date() : null,
      lineItems: { create: lines },
    },
    select: { id: true },
  });
  return (await getPurchaseOrder(created.id))!;
}

export async function updatePurchaseOrder(id: string, input: CreatePOInput): Promise<PurchaseOrderDetail> {
  const user = await requireUser();
  const existing = await prisma.purchaseOrder.findFirst({ where: { id, companyId: user.company.id }, select: { status: true, projectId: true } });
  if (!existing) throw new Error("NOT_FOUND");
  await assertProjectAccess(user, existing.projectId);
  if (existing.status !== "DRAFT") throw new Error("IMMUTABLE");
  const lines = lineData(input);
  const total = lines.reduce((s, l) => s + l.amountPaise, BigInt(0));
  await prisma.$transaction([
    prisma.pOLineItem.deleteMany({ where: { purchaseOrderId: id } }),
    prisma.purchaseOrder.update({
      where: { id },
      data: {
        vendorId: input.vendorId,
        projectId: input.projectId,
        purchaseDate: new Date(input.purchaseDate),
        invoiceNumber: input.invoiceNumber ?? null,
        notes: input.notes ?? null,
        totalPaise: total,
        lineItems: { create: lines },
      },
    }),
  ]);
  return (await getPurchaseOrder(id))!;
}

export async function submitPurchaseOrder(id: string): Promise<PurchaseOrderListItem> {
  const user = await requireUser();
  const po = await prisma.purchaseOrder.update({ where: { id, companyId: user.company.id }, data: { status: "SUBMITTED" }, include: { vendor: { select: { businessName: true } }, project: { select: { name: true, code: true } } } });
  return toListItem(po);
}

export async function approvePurchaseOrder(id: string): Promise<PurchaseOrderListItem> {
  const user = await requireUser();
  assertOwner(user);
  const po = await prisma.purchaseOrder.update({
    where: { id, companyId: user.company.id },
    data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() },
    include: { vendor: { select: { businessName: true } }, project: { select: { name: true, code: true } } },
  });
  return toListItem(po);
}

export async function revisePurchaseOrder(id: string): Promise<PurchaseOrderDetail> {
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
      purchaseDate: src.purchaseDate,
      notes: src.notes,
      totalPaise: src.totalPaise,
      createdById: user.id,
      revisedFromId: src.id,
      lineItems: {
        create: src.lineItems.map((l) => ({
          material: l.material,
          quantity: l.quantity,
          unit: l.unit,
          ratePaise: l.ratePaise,
          amountPaise: l.amountPaise,
          sortOrder: l.sortOrder,
        })),
      },
    },
    select: { id: true },
  });
  return (await getPurchaseOrder(created.id))!;
}

export async function deletePurchaseOrder(id: string): Promise<void> {
  const user = await requireUser();
  assertOwner(user);
  await prisma.purchaseOrder.delete({ where: { id, companyId: user.company.id } });
}

export async function pendingApprovalCount(): Promise<number> {
  const user = await requireUser();
  return prisma.purchaseOrder.count({ where: { companyId: user.company.id, status: "SUBMITTED" } });
}
