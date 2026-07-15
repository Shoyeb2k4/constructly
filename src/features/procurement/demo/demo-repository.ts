import type { ProcurementRepository } from "../repository";
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
import { demoApprovalRequired } from "@/features/budget/spend";
import {
  DEMO_VENDORS,
  demoPurchaseOrders,
  type PORecord,
  type VendorRecord,
} from "./seed";

const K = {
  vendors: "constructly.demo.vendors.v1",
  pos: "constructly.demo.pos.v1",
  projects: "constructly.demo.projects.v1",
};
const ACTOR = "Aarav Mehta";

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

function read<T>(key: string, seed: () => T[]): T[] {
  if (typeof window === "undefined") return seed();
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T[];
  } catch {
    /* ignore */
  }
  const seeded = structuredClone(seed());
  write(key, seeded);
  return seeded;
}
function write<T>(key: string, rows: T[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(rows));
  } catch {
    /* quota */
  }
}

const loadVendors = () => read<VendorRecord>(K.vendors, () => DEMO_VENDORS);
const loadPOs = () => read<PORecord>(K.pos, () => demoPurchaseOrders());

function projectMeta(): Map<string, { name: string; code: string }> {
  const m = new Map<string, { name: string; code: string }>();
  if (typeof window === "undefined") return m;
  try {
    (JSON.parse(window.localStorage.getItem(K.projects) ?? "[]") as {
      id: string;
      name: string;
      code: string;
    }[]).forEach((p) => m.set(p.id, { name: p.name, code: p.code }));
  } catch {
    /* ignore */
  }
  return m;
}

function vendorRollup(v: VendorRecord, pos: PORecord[]): Vendor {
  const theirs = pos.filter((p) => p.vendorId === v.id && p.status !== "DRAFT");
  return {
    id: v.id,
    businessName: v.businessName,
    contactPerson: v.contactPerson,
    phone: v.phone,
    email: v.email,
    gstin: v.gstin,
    address: v.address,
    materialsSupplied: v.materialsSupplied,
    paymentTerms: v.paymentTerms,
    status: v.status,
    notes: v.notes,
    isFavorite: v.isFavorite,
    totalPurchasedPaise: theirs.reduce((s, p) => s + p.totalPaise, 0),
    poCount: theirs.length,
  };
}

function toListItem(
  po: PORecord,
  vendors: VendorRecord[],
  meta: Map<string, { name: string; code: string }>,
): PurchaseOrderListItem {
  const v = vendors.find((x) => x.id === po.vendorId);
  const pm = meta.get(po.projectId);
  return {
    id: po.id,
    poNumber: po.poNumber,
    status: po.status,
    purchaseDate: po.purchaseDate,
    totalPaise: po.totalPaise,
    invoiceNumber: po.invoiceNumber,
    vendor: { id: po.vendorId, name: v?.businessName ?? "Unknown" },
    project: { id: po.projectId, name: pm?.name ?? "Unknown", code: pm?.code ?? "" },
    createdAt: po.createdAt,
  };
}

function toDetail(po: PORecord, vendors: VendorRecord[], allPos: PORecord[], meta: Map<string, { name: string; code: string }>): PurchaseOrderDetail {
  const from = po.revisedFromId ? allPos.find((p) => p.id === po.revisedFromId) : null;
  return {
    ...toListItem(po, vendors, meta),
    notes: po.notes,
    lineItems: po.lineItems.map((l) => ({
      id: l.id,
      material: l.material,
      quantity: l.quantity,
      unit: l.unit,
      ratePaise: l.ratePaise,
      amountPaise: l.amountPaise,
      sortOrder: l.sortOrder,
    })),
    createdByName: po.createdByName,
    approvedByName: po.approvedByName,
    approvedAt: po.approvedAt,
    revisedFromId: po.revisedFromId,
    revisedFromNumber: from?.poNumber ?? null,
  };
}

function nextPoNumber(pos: PORecord[]): string {
  const max = pos.reduce((m, p) => {
    const n = Number(/PO-(\d+)/.exec(p.poNumber)?.[1] ?? 0);
    return Math.max(m, n);
  }, 0);
  return `PO-${String(max + 1).padStart(4, "0")}`;
}

function buildLines(input: CreatePOInput) {
  return input.lineItems.map((l, i) => ({
    id: uid(),
    material: l.material,
    quantity: l.quantity,
    unit: l.unit,
    ratePaise: l.ratePaise,
    amountPaise: Math.round(l.quantity * l.ratePaise),
    sortOrder: i,
  }));
}

export const demoProcurementRepository: ProcurementRepository = {
  async listVendors(filters: VendorFilters = {}) {
    const pos = loadPOs();
    let rows = loadVendors();
    if (filters.status && filters.status !== "ALL") rows = rows.filter((v) => v.status === filters.status);
    if (filters.material && filters.material !== "ALL")
      rows = rows.filter((v) => v.materialsSupplied.includes(filters.material!));
    if (filters.favoritesOnly) rows = rows.filter((v) => v.isFavorite);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter(
        (v) =>
          v.businessName.toLowerCase().includes(q) ||
          (v.contactPerson ?? "").toLowerCase().includes(q) ||
          v.materialsSupplied.some((m) => m.toLowerCase().includes(q)),
      );
    }
    return rows.sort((a, b) => a.businessName.localeCompare(b.businessName)).map((v) => vendorRollup(v, pos));
  },

  async getVendor(id) {
    const v = loadVendors().find((x) => x.id === id);
    if (!v) return null;
    const pos = loadPOs();
    const vendors = loadVendors();
    const meta = projectMeta();
    return {
      ...vendorRollup(v, pos),
      purchaseHistory: pos
        .filter((p) => p.vendorId === id)
        .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))
        .map((p) => toListItem(p, vendors, meta)),
    } satisfies VendorDetail;
  },

  async createVendor(input: CreateVendorInput) {
    const rows = loadVendors();
    const rec: VendorRecord = {
      id: uid(),
      businessName: input.businessName,
      contactPerson: input.contactPerson ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      gstin: input.gstin ?? null,
      address: input.address ?? null,
      materialsSupplied: input.materialsSupplied ?? [],
      paymentTerms: input.paymentTerms ?? null,
      status: "ACTIVE",
      notes: input.notes ?? null,
      isFavorite: false,
    };
    rows.push(rec);
    write(K.vendors, rows);
    return vendorRollup(rec, loadPOs());
  },

  async updateVendor(id, patch: UpdateVendorInput) {
    const rows = loadVendors();
    const rec = rows.find((v) => v.id === id);
    if (!rec) throw new Error("NOT_FOUND");
    Object.assign(rec, patch);
    write(K.vendors, rows);
    return vendorRollup(rec, loadPOs());
  },

  async setVendorStatus(id, status: VendorStatus) {
    return this.updateVendor(id, { status });
  },

  async toggleVendorFavorite(id) {
    const rows = loadVendors();
    const rec = rows.find((v) => v.id === id);
    if (!rec) throw new Error("NOT_FOUND");
    rec.isFavorite = !rec.isFavorite;
    write(K.vendors, rows);
    return rec.isFavorite;
  },

  async listMaterials() {
    return [...new Set(loadVendors().flatMap((v) => v.materialsSupplied))].sort();
  },

  async listPurchaseOrders(filters: POFilters = {}) {
    const vendors = loadVendors();
    const meta = projectMeta();
    let rows = loadPOs();
    if (filters.status && filters.status !== "ALL") rows = rows.filter((p) => p.status === filters.status);
    if (filters.projectId && filters.projectId !== "ALL") rows = rows.filter((p) => p.projectId === filters.projectId);
    if (filters.vendorId && filters.vendorId !== "ALL") rows = rows.filter((p) => p.vendorId === filters.vendorId);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter(
        (p) =>
          p.poNumber.toLowerCase().includes(q) ||
          (vendors.find((v) => v.id === p.vendorId)?.businessName ?? "").toLowerCase().includes(q) ||
          p.lineItems.some((l) => l.material.toLowerCase().includes(q)),
      );
    }
    return rows
      .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))
      .map((p) => toListItem(p, vendors, meta));
  },

  async getPurchaseOrder(id) {
    const pos = loadPOs();
    const po = pos.find((p) => p.id === id);
    if (!po) return null;
    return toDetail(po, loadVendors(), pos, projectMeta());
  },

  async createPurchaseOrder(input: CreatePOInput) {
    const pos = loadPOs();
    const finalize = !demoApprovalRequired();
    const lineItems = buildLines(input);
    const rec: PORecord = {
      id: uid(),
      poNumber: nextPoNumber(pos),
      vendorId: input.vendorId,
      projectId: input.projectId,
      status: finalize ? "APPROVED" : "DRAFT",
      invoiceNumber: input.invoiceNumber ?? null,
      purchaseDate: input.purchaseDate,
      notes: input.notes ?? null,
      totalPaise: lineItems.reduce((s, l) => s + l.amountPaise, 0),
      createdByName: ACTOR,
      approvedByName: finalize ? ACTOR : null,
      approvedAt: finalize ? new Date().toISOString() : null,
      revisedFromId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lineItems,
    };
    pos.push(rec);
    write(K.pos, pos);
    return toDetail(rec, loadVendors(), pos, projectMeta());
  },

  async updatePurchaseOrder(id, input: CreatePOInput) {
    const pos = loadPOs();
    const rec = pos.find((p) => p.id === id);
    if (!rec) throw new Error("NOT_FOUND");
    if (rec.status !== "DRAFT") throw new Error("IMMUTABLE");
    const lineItems = buildLines(input);
    Object.assign(rec, {
      vendorId: input.vendorId,
      projectId: input.projectId,
      purchaseDate: input.purchaseDate,
      invoiceNumber: input.invoiceNumber ?? null,
      notes: input.notes ?? null,
      lineItems,
      totalPaise: lineItems.reduce((s, l) => s + l.amountPaise, 0),
      updatedAt: new Date().toISOString(),
    });
    write(K.pos, pos);
    return toDetail(rec, loadVendors(), pos, projectMeta());
  },

  async submitPurchaseOrder(id) {
    const pos = loadPOs();
    const rec = pos.find((p) => p.id === id);
    if (!rec) throw new Error("NOT_FOUND");
    rec.status = "SUBMITTED";
    rec.updatedAt = new Date().toISOString();
    write(K.pos, pos);
    return toListItem(rec, loadVendors(), projectMeta());
  },

  async approvePurchaseOrder(id) {
    const pos = loadPOs();
    const rec = pos.find((p) => p.id === id);
    if (!rec) throw new Error("NOT_FOUND");
    rec.status = "APPROVED";
    rec.approvedByName = ACTOR;
    rec.approvedAt = new Date().toISOString();
    rec.updatedAt = rec.approvedAt;
    write(K.pos, pos);
    return toListItem(rec, loadVendors(), projectMeta());
  },

  async revisePurchaseOrder(id) {
    const pos = loadPOs();
    const src = pos.find((p) => p.id === id);
    if (!src) throw new Error("NOT_FOUND");
    const copy: PORecord = {
      ...structuredClone(src),
      id: uid(),
      poNumber: `${nextPoNumber(pos)}`,
      status: "DRAFT",
      invoiceNumber: null,
      approvedByName: null,
      approvedAt: null,
      revisedFromId: src.id,
      createdByName: ACTOR,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lineItems: src.lineItems.map((l) => ({ ...l, id: uid() })),
    };
    pos.push(copy);
    write(K.pos, pos);
    return toDetail(copy, loadVendors(), pos, projectMeta());
  },

  async deletePurchaseOrder(id) {
    write(K.pos, loadPOs().filter((p) => p.id !== id));
  },

  async pendingApprovalCount() {
    return loadPOs().filter((p) => p.status === "SUBMITTED").length;
  },
};
