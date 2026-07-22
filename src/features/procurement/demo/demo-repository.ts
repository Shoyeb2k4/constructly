import type { ProcurementRepository } from "../repository";
import type {
  CreatePaymentInput,
  CreatePOInput,
  CreateVendorInput,
  PaymentFilters,
  POFilters,
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
import {
  agingBuckets,
  lineAmountPaise,
  lineGstPaise,
  outstandingPaise,
  poCounted,
  poPaymentStatus,
  poTotals,
  projectProcurementSummary,
  projectVendorRollups,
  vendorProjectRollups,
  type PaymentForRollup,
  type POForRollup,
} from "../calc";
import { DEFAULT_MATERIAL_CATEGORIES } from "../constants";
import { demoApprovalRequired } from "@/features/budget/spend";
import {
  DEMO_VENDORS,
  demoPayments,
  demoPurchaseOrders,
  demoVendorDocs,
  type PaymentRecord,
  type PORecord,
  type VendorDocRecord,
  type VendorRecord,
} from "./seed";

const K = {
  vendors: "constructly.demo.vendors.v2",
  pos: "constructly.demo.pos.v2",
  payments: "constructly.demo.vendorPayments.v1",
  vendorDocs: "constructly.demo.vendorDocs.v1",
  projects: "constructly.demo.projects.v1",
  settings: "constructly.demo.settings.v1",
  // Legacy (pre-GST / pre-payments) stores migrated by ensureStores().
  vendorsV1: "constructly.demo.vendors.v1",
  posV1: "constructly.demo.pos.v1",
};
const ACTOR = "Aarav Mehta";

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

function read<T>(key: string, seed: () => T[]): T[] {
  if (typeof window === "undefined") return structuredClone(seed());
  ensureStores();
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

/**
 * One-time v1 → v2 migration. Old flat-GST-less procurement data is upgraded
 * in place — every PO keeps its id, number, status, and total (subtotal = old
 * total, GST = 0), so budgets and history are byte-identical after migration.
 */
function ensureStores(): void {
  if (typeof window === "undefined") return;
  const ls = window.localStorage;
  // Idempotent: once v2 exists (or no legacy present), the checks below no-op.
  try {
    if (!ls.getItem(K.vendors) && ls.getItem(K.vendorsV1)) {
      const old = JSON.parse(ls.getItem(K.vendorsV1)!) as Omit<VendorRecord, "pan">[];
      ls.setItem(K.vendors, JSON.stringify(old.map((v) => ({ ...v, pan: null }))));
      ls.removeItem(K.vendorsV1);
    }
    if (!ls.getItem(K.pos) && ls.getItem(K.posV1)) {
      type OldLine = { id: string; material: string; quantity: number; unit: string; ratePaise: number; amountPaise: number; sortOrder: number };
      type OldPO = Omit<PORecord, "expectedDelivery" | "subtotalPaise" | "gstPaise" | "lineItems"> & { lineItems: OldLine[] };
      const old = JSON.parse(ls.getItem(K.posV1)!) as OldPO[];
      const migrated: PORecord[] = old.map((p) => ({
        ...p,
        expectedDelivery: null,
        subtotalPaise: p.totalPaise,
        gstPaise: 0,
        lineItems: p.lineItems.map((l) => ({ ...l, category: null, gstRateBps: 0, gstPaise: 0 })),
      }));
      ls.setItem(K.pos, JSON.stringify(migrated));
      ls.removeItem(K.posV1);
    }
  } catch {
    /* corrupt legacy data → fall through to fresh seed */
  }
}

const loadVendors = () => read<VendorRecord>(K.vendors, () => DEMO_VENDORS);
const loadPOs = () => read<PORecord>(K.pos, () => demoPurchaseOrders());
const loadPayments = () => read<PaymentRecord>(K.payments, () => demoPayments());
const loadVendorDocs = () => read<VendorDocRecord>(K.vendorDocs, () => demoVendorDocs());

function readSettings(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(K.settings) ?? "{}");
  } catch {
    return {};
  }
}
function writeSettings(patch: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(K.settings, JSON.stringify({ ...readSettings(), ...patch }));
  } catch {
    /* quota */
  }
}

function projectMeta(): Map<string, { name: string; code: string; procurementBudgetPaise: number | null }> {
  const m = new Map<string, { name: string; code: string; procurementBudgetPaise: number | null }>();
  if (typeof window === "undefined") return m;
  try {
    (JSON.parse(window.localStorage.getItem(K.projects) ?? "[]") as {
      id: string;
      name: string;
      code: string;
      procurementBudgetPaise?: number | null;
    }[]).forEach((p) =>
      m.set(p.id, { name: p.name, code: p.code, procurementBudgetPaise: p.procurementBudgetPaise ?? null }),
    );
  } catch {
    /* ignore */
  }
  return m;
}

/* ── Pure-calc adapters ──────────────────────────────────────────────── */

function toRollupPO(p: PORecord): POForRollup {
  return {
    id: p.id,
    vendorId: p.vendorId,
    projectId: p.projectId,
    status: p.status,
    totalPaise: p.totalPaise,
    purchaseDate: p.purchaseDate,
    materials: [...new Set(p.lineItems.map((l) => l.material))],
  };
}
const toRollupPayment = (p: PaymentRecord): PaymentForRollup => p;

function vendorRollup(v: VendorRecord, pos: PORecord[], payments: PaymentRecord[]): Vendor {
  const approval = demoApprovalRequired();
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
    isFavorite: v.isFavorite,
    totalPurchasedPaise: counted.reduce((s, p) => s + p.totalPaise, 0),
    outstandingPaise: outstandingPaise(
      pos.map(toRollupPO),
      payments.map(toRollupPayment),
      { vendorId: v.id },
      approval,
    ),
    poCount: counted.length,
    projectsServed: new Set(counted.map((p) => p.projectId)).size,
  };
}

function paidByPO(payments: PaymentRecord[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of payments) {
    if (p.purchaseOrderId) m.set(p.purchaseOrderId, (m.get(p.purchaseOrderId) ?? 0) + p.amountPaise);
  }
  return m;
}

function toListItem(
  po: PORecord,
  vendors: VendorRecord[],
  meta: Map<string, { name: string; code: string }>,
  paid: Map<string, number>,
): PurchaseOrderListItem {
  const v = vendors.find((x) => x.id === po.vendorId);
  const pm = meta.get(po.projectId);
  const paidPaise = paid.get(po.id) ?? 0;
  return {
    id: po.id,
    poNumber: po.poNumber,
    status: po.status,
    purchaseDate: po.purchaseDate,
    expectedDelivery: po.expectedDelivery,
    subtotalPaise: po.subtotalPaise,
    gstPaise: po.gstPaise,
    totalPaise: po.totalPaise,
    paidPaise,
    paymentStatus: poPaymentStatus(po.totalPaise, paidPaise),
    invoiceNumber: po.invoiceNumber,
    vendor: { id: po.vendorId, name: v?.businessName ?? "Unknown" },
    project: { id: po.projectId, name: pm?.name ?? "Unknown", code: pm?.code ?? "" },
    createdAt: po.createdAt,
  };
}

function toPaymentItem(
  p: PaymentRecord,
  vendors: VendorRecord[],
  pos: PORecord[],
  meta: Map<string, { name: string; code: string }>,
): VendorPaymentItem {
  const po = p.purchaseOrderId ? pos.find((x) => x.id === p.purchaseOrderId) : null;
  const pm = meta.get(p.projectId);
  return {
    id: p.id,
    vendor: { id: p.vendorId, name: vendors.find((v) => v.id === p.vendorId)?.businessName ?? "Unknown" },
    project: { id: p.projectId, name: pm?.name ?? "Unknown", code: pm?.code ?? "" },
    purchaseOrder: po ? { id: po.id, poNumber: po.poNumber } : null,
    amountPaise: p.amountPaise,
    paymentMode: p.paymentMode,
    referenceNumber: p.referenceNumber,
    date: p.date,
    remarks: p.remarks,
    createdByName: p.createdByName,
    createdAt: p.createdAt,
  };
}

function toDetail(
  po: PORecord,
  vendors: VendorRecord[],
  allPos: PORecord[],
  payments: PaymentRecord[],
  meta: Map<string, { name: string; code: string }>,
): PurchaseOrderDetail {
  const from = po.revisedFromId ? allPos.find((p) => p.id === po.revisedFromId) : null;
  return {
    ...toListItem(po, vendors, meta, paidByPO(payments)),
    notes: po.notes,
    lineItems: po.lineItems.map((l) => ({ ...l })),
    payments: payments
      .filter((p) => p.purchaseOrderId === po.id)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((p) => toPaymentItem(p, vendors, allPos, meta)),
    createdByName: po.createdByName,
    approvedByName: po.approvedByName,
    approvedAt: po.approvedAt,
    revisedFromId: po.revisedFromId,
    revisedFromNumber: from?.poNumber ?? null,
  };
}

function nextPoNumber(pos: PORecord[]): string {
  const max = pos.reduce((m, p) => Math.max(m, Number(/PO-(\d+)/.exec(p.poNumber)?.[1] ?? 0)), 0);
  return `PO-${String(max + 1).padStart(4, "0")}`;
}

function buildLines(input: CreatePOInput) {
  return input.lineItems.map((l, i) => ({
    id: uid(),
    material: l.material,
    category: l.category ?? null,
    quantity: l.quantity,
    unit: l.unit,
    ratePaise: l.ratePaise,
    gstRateBps: l.gstRateBps,
    gstPaise: lineGstPaise(l.quantity, l.ratePaise, l.gstRateBps),
    amountPaise: lineAmountPaise(l.quantity, l.ratePaise),
    sortOrder: i,
  }));
}

export const demoProcurementRepository: ProcurementRepository = {
  async listVendors(filters: VendorFilters = {}) {
    const pos = loadPOs();
    const payments = loadPayments();
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
    return rows
      .sort((a, b) => a.businessName.localeCompare(b.businessName))
      .map((v) => vendorRollup(v, pos, payments));
  },

  async getVendor(id) {
    const v = loadVendors().find((x) => x.id === id);
    if (!v) return null;
    const pos = loadPOs();
    const vendors = loadVendors();
    const payments = loadPayments();
    const meta = projectMeta();
    const approval = demoApprovalRequired();
    const paid = paidByPO(payments);
    const rollups = vendorProjectRollups(pos.map(toRollupPO), payments.map(toRollupPayment), id, approval);
    return {
      ...vendorRollup(v, pos, payments),
      purchaseHistory: pos
        .filter((p) => p.vendorId === id)
        .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))
        .map((p) => toListItem(p, vendors, meta, paid)),
      payments: payments
        .filter((p) => p.vendorId === id)
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((p) => toPaymentItem(p, vendors, pos, meta)),
      projects: rollups.map((r) => ({
        ...r,
        project: { id: r.id, name: meta.get(r.id)?.name ?? "Unknown", code: meta.get(r.id)?.code ?? "" },
      })),
      documents: loadVendorDocs()
        .filter((d) => d.vendorId === id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((d) => ({
          id: d.id,
          category: d.category,
          filename: d.filename,
          sizeBytes: d.sizeBytes,
          mimeType: d.mimeType,
          storagePath: d.storagePath,
          createdAt: d.createdAt,
        })),
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
      pan: input.pan ?? null,
      address: input.address ?? null,
      materialsSupplied: input.materialsSupplied ?? [],
      paymentTerms: input.paymentTerms ?? null,
      status: "ACTIVE",
      notes: input.notes ?? null,
      isFavorite: false,
    };
    rows.push(rec);
    write(K.vendors, rows);
    return vendorRollup(rec, loadPOs(), loadPayments());
  },

  async updateVendor(id, patch: UpdateVendorInput) {
    const rows = loadVendors();
    const rec = rows.find((v) => v.id === id);
    if (!rec) throw new Error("NOT_FOUND");
    Object.assign(rec, patch);
    write(K.vendors, rows);
    return vendorRollup(rec, loadPOs(), loadPayments());
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

  async addVendorDocument(vendorId, doc) {
    const docs = loadVendorDocs();
    docs.push({
      id: uid(),
      vendorId,
      category: doc.mimeType.startsWith("image/") ? "PHOTO" : doc.mimeType === "application/pdf" ? "PDF" : "OTHER",
      filename: doc.filename,
      sizeBytes: doc.sizeBytes,
      mimeType: doc.mimeType,
      storagePath: `demo/vendors/${vendorId}/${doc.filename}`,
      createdAt: new Date().toISOString(),
    });
    write(K.vendorDocs, docs);
    return (await this.getVendor(vendorId))!;
  },

  async removeVendorDocument(vendorId, docId) {
    write(K.vendorDocs, loadVendorDocs().filter((d) => d.id !== docId));
    return (await this.getVendor(vendorId))!;
  },

  async listMaterialCategories() {
    const fromSettings = readSettings().materialCategories as string[] | undefined;
    if (Array.isArray(fromSettings) && fromSettings.length) return fromSettings;
    const seeded = [...DEFAULT_MATERIAL_CATEGORIES];
    writeSettings({ materialCategories: seeded });
    return seeded;
  },

  async setMaterialCategories(categories: string[]) {
    const clean = [...new Set(categories.map((c) => c.trim()).filter(Boolean))];
    writeSettings({ materialCategories: clean });
    return clean;
  },

  async listPurchaseOrders(filters: POFilters = {}) {
    const vendors = loadVendors();
    const meta = projectMeta();
    const payments = loadPayments();
    const paid = paidByPO(payments);
    let rows = loadPOs();
    if (filters.status && filters.status !== "ALL") rows = rows.filter((p) => p.status === filters.status);
    if (filters.projectId && filters.projectId !== "ALL") rows = rows.filter((p) => p.projectId === filters.projectId);
    if (filters.vendorId && filters.vendorId !== "ALL") rows = rows.filter((p) => p.vendorId === filters.vendorId);
    if (filters.material && filters.material !== "ALL")
      rows = rows.filter((p) => p.lineItems.some((l) => l.material === filters.material));
    if (filters.category && filters.category !== "ALL")
      rows = rows.filter((p) => p.lineItems.some((l) => l.category === filters.category));
    if (filters.dateFrom) rows = rows.filter((p) => p.purchaseDate >= filters.dateFrom!);
    if (filters.dateTo) rows = rows.filter((p) => p.purchaseDate <= filters.dateTo!);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter(
        (p) =>
          p.poNumber.toLowerCase().includes(q) ||
          (vendors.find((v) => v.id === p.vendorId)?.businessName ?? "").toLowerCase().includes(q) ||
          p.lineItems.some((l) => l.material.toLowerCase().includes(q)),
      );
    }
    let items = rows
      .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))
      .map((p) => toListItem(p, vendors, meta, paid));
    if (filters.paymentStatus && filters.paymentStatus !== "ALL")
      items = items.filter((i) => i.paymentStatus === filters.paymentStatus);
    return items;
  },

  async getPurchaseOrder(id) {
    const pos = loadPOs();
    const po = pos.find((p) => p.id === id);
    if (!po) return null;
    return toDetail(po, loadVendors(), pos, loadPayments(), projectMeta());
  },

  async createPurchaseOrder(input: CreatePOInput) {
    const pos = loadPOs();
    const finalize = !demoApprovalRequired();
    const lineItems = buildLines(input);
    const totals = poTotals(input.lineItems);
    const rec: PORecord = {
      id: uid(),
      poNumber: nextPoNumber(pos),
      vendorId: input.vendorId,
      projectId: input.projectId,
      status: finalize ? "APPROVED" : "DRAFT",
      invoiceNumber: input.invoiceNumber ?? null,
      purchaseDate: input.purchaseDate,
      expectedDelivery: input.expectedDelivery ?? null,
      notes: input.notes ?? null,
      subtotalPaise: totals.subtotalPaise,
      gstPaise: totals.gstPaise,
      totalPaise: totals.totalPaise,
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
    return toDetail(rec, loadVendors(), pos, loadPayments(), projectMeta());
  },

  async updatePurchaseOrder(id, input: CreatePOInput) {
    const pos = loadPOs();
    const rec = pos.find((p) => p.id === id);
    if (!rec) throw new Error("NOT_FOUND");
    if (rec.status !== "DRAFT") throw new Error("IMMUTABLE");
    const lineItems = buildLines(input);
    const totals = poTotals(input.lineItems);
    Object.assign(rec, {
      vendorId: input.vendorId,
      projectId: input.projectId,
      purchaseDate: input.purchaseDate,
      expectedDelivery: input.expectedDelivery ?? null,
      invoiceNumber: input.invoiceNumber ?? null,
      notes: input.notes ?? null,
      lineItems,
      subtotalPaise: totals.subtotalPaise,
      gstPaise: totals.gstPaise,
      totalPaise: totals.totalPaise,
      updatedAt: new Date().toISOString(),
    });
    write(K.pos, pos);
    return toDetail(rec, loadVendors(), pos, loadPayments(), projectMeta());
  },

  async submitPurchaseOrder(id) {
    const pos = loadPOs();
    const rec = pos.find((p) => p.id === id);
    if (!rec) throw new Error("NOT_FOUND");
    rec.status = "SUBMITTED";
    rec.updatedAt = new Date().toISOString();
    write(K.pos, pos);
    return toListItem(rec, loadVendors(), projectMeta(), paidByPO(loadPayments()));
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
    return toListItem(rec, loadVendors(), projectMeta(), paidByPO(loadPayments()));
  },

  async revisePurchaseOrder(id) {
    return cloneAsDraft(id, { linkRevision: true });
  },

  async duplicatePurchaseOrder(id) {
    return cloneAsDraft(id, { linkRevision: false });
  },

  async deletePurchaseOrder(id) {
    write(K.pos, loadPOs().filter((p) => p.id !== id));
  },

  async pendingApprovalCount() {
    return loadPOs().filter((p) => p.status === "SUBMITTED").length;
  },

  /* ── Payments ──────────────────────────────────────────────────────── */

  async listPayments(filters: PaymentFilters = {}) {
    const vendors = loadVendors();
    const pos = loadPOs();
    const meta = projectMeta();
    let rows = loadPayments();
    if (filters.vendorId && filters.vendorId !== "ALL") rows = rows.filter((p) => p.vendorId === filters.vendorId);
    if (filters.projectId && filters.projectId !== "ALL") rows = rows.filter((p) => p.projectId === filters.projectId);
    if (filters.purchaseOrderId) rows = rows.filter((p) => p.purchaseOrderId === filters.purchaseOrderId);
    if (filters.mode && filters.mode !== "ALL") rows = rows.filter((p) => p.paymentMode === filters.mode);
    if (filters.dateFrom) rows = rows.filter((p) => p.date >= filters.dateFrom!);
    if (filters.dateTo) rows = rows.filter((p) => p.date <= filters.dateTo!);
    return rows
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((p) => toPaymentItem(p, vendors, pos, meta));
  },

  async createPayment(input: CreatePaymentInput) {
    const rows = loadPayments();
    // Idempotency parity with the server: a repeated clientUuid is deduped.
    if (input.clientUuid) {
      const existing = rows.find((p) => p.clientUuid === input.clientUuid);
      if (existing) return toPaymentItem(existing, loadVendors(), loadPOs(), projectMeta());
    }
    const rec: PaymentRecord = {
      id: uid(),
      vendorId: input.vendorId,
      projectId: input.projectId,
      purchaseOrderId: input.purchaseOrderId ?? null,
      amountPaise: input.amountPaise,
      paymentMode: input.paymentMode,
      referenceNumber: input.referenceNumber ?? null,
      date: input.date,
      remarks: input.remarks ?? null,
      clientUuid: input.clientUuid ?? null,
      createdByName: ACTOR,
      createdAt: new Date().toISOString(),
    };
    rows.push(rec);
    write(K.payments, rows);
    return toPaymentItem(rec, loadVendors(), loadPOs(), projectMeta());
  },

  async deletePayment(id) {
    write(K.payments, loadPayments().filter((p) => p.id !== id));
  },

  /* ── Project-aware views ───────────────────────────────────────────── */

  async getProjectProcurement(projectId) {
    const pos = loadPOs();
    const payments = loadPayments();
    const vendors = loadVendors();
    const meta = projectMeta();
    const approval = demoApprovalRequired();
    const rollupPOs = pos.map(toRollupPO);
    const rollupPays = payments.map(toRollupPayment);
    const paid = paidByPO(payments);
    return {
      summary: projectProcurementSummary(
        meta.get(projectId)?.procurementBudgetPaise ?? null,
        rollupPOs,
        rollupPays,
        projectId,
        approval,
      ),
      vendors: projectVendorRollups(rollupPOs, rollupPays, projectId, approval).map((r) => {
        const v = vendors.find((x) => x.id === r.id);
        return { ...r, vendor: { id: r.id, name: v?.businessName ?? "Unknown", status: v?.status ?? "ACTIVE" } };
      }),
      purchaseOrders: pos
        .filter((p) => p.projectId === projectId)
        .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))
        .map((p) => toListItem(p, vendors, meta, paid)),
      payments: payments
        .filter((p) => p.projectId === projectId)
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((p) => toPaymentItem(p, vendors, pos, meta)),
    } satisfies ProjectProcurement;
  },

  async vendorAging(vendorId, projectId) {
    const pos = loadPOs();
    const buckets = agingBuckets(
      pos.map(toRollupPO),
      loadPayments().map(toRollupPayment),
      vendorId,
      demoApprovalRequired(),
      new Date().toISOString().slice(0, 10),
      projectId,
    );
    // Decorate rows with PO numbers for the UI.
    const byId = new Map(pos.map((p) => [p.id, p.poNumber]));
    buckets.rows.forEach((r) => (r.poNumber = byId.get(r.poId)));
    return buckets;
  },
};

function cloneAsDraft(id: string, opts: { linkRevision: boolean }): PurchaseOrderDetail {
  const pos = loadPOs();
  const src = pos.find((p) => p.id === id);
  if (!src) throw new Error("NOT_FOUND");
  const today = new Date().toISOString().slice(0, 10);
  const copy: PORecord = {
    ...structuredClone(src),
    id: uid(),
    poNumber: nextPoNumber(pos),
    status: "DRAFT",
    invoiceNumber: null,
    approvedByName: null,
    approvedAt: null,
    revisedFromId: opts.linkRevision ? src.id : null,
    // Duplicates are fresh purchases dated today; revisions keep the source date.
    purchaseDate: opts.linkRevision ? src.purchaseDate : today,
    expectedDelivery: opts.linkRevision ? src.expectedDelivery : null,
    createdByName: ACTOR,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lineItems: src.lineItems.map((l) => ({ ...l, id: uid() })),
  };
  pos.push(copy);
  write(K.pos, pos);
  return toDetail(copy, loadVendors(), pos, loadPayments(), projectMeta());
}
