import type { ProcurementRepository } from "../repository";
import type {
  CreateMaterialInput,
  CreatePaymentInput,
  CreatePOInput,
  CreateVendorInput,
  Material,
  MaterialFilters,
  UpdateMaterialInput,
  PaymentFilters,
  POFilters,
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
import { DEFAULT_MATERIAL_CATEGORIES, UNITS } from "../constants";
import { normalizeMaterialName } from "../material-backfill";
import {
  distinctMaterialLabels,
  materialFilterIntent,
  materialIndex,
  matchesRecordedName,
  unlinkedRecordedNames,
  type MaterialIdentityRef,
} from "../material-identity";
import {
  buildMirror,
  planLegacyVendorMaterials,
  unlinkedLegacyNames,
} from "../vendor-legacy-materials";
import { poComparator } from "../sort";
import { demoApprovalRequired } from "@/features/budget/spend";
import {
  DEMO_VENDORS,
  demoMaterials,
  demoPayments,
  demoPurchaseOrders,
  demoVendorDocs,
  demoVendorMaterials,
  type MaterialRecord,
  type PaymentRecord,
  type PORecord,
  type VendorDocRecord,
  type VendorMaterialRecord,
  type VendorRecord,
} from "./seed";

const K = {
  vendors: "constructly.demo.vendors.v2",
  pos: "constructly.demo.pos.v2",
  payments: "constructly.demo.vendorPayments.v1",
  vendorDocs: "constructly.demo.vendorDocs.v1",
  materials: "constructly.demo.materials.v1",
  vendorMaterials: "constructly.demo.vendorMaterials.v1",
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
const loadMaterials = () => read<MaterialRecord>(K.materials, () => demoMaterials());
const loadVendorMaterials = () =>
  read<VendorMaterialRecord>(K.vendorMaterials, () => demoVendorMaterials());

function toMaterialDTO(m: MaterialRecord): Material {
  return {
    id: m.id,
    name: m.name,
    category: m.category,
    defaultUnit: m.defaultUnit,
    hsnCode: m.hsnCode,
    displayOrder: m.displayOrder,
    isActive: m.deletedAt === null,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

/** Demo stand-in for the server's tenant guard. */
function assertDemoVendor(vendorId: string): void {
  if (!loadVendors().some((v) => v.id === vendorId)) throw new Error("NOT_FOUND");
}

function assertDemoUnit(unit: string | null | undefined): void {
  if (unit === null || unit === undefined || unit === "") return;
  if (!(UNITS as readonly string[]).includes(unit)) throw new Error("INVALID_UNIT");
}

/** Same error shape as the server: unknown id is NOT_FOUND, deactivated is
 *  MATERIAL_ARCHIVED. */
function resolveDemoActiveMaterials(ids: string[]): MaterialRecord[] {
  const rows = loadMaterials();
  const out: MaterialRecord[] = [];
  for (const id of ids) {
    const m = rows.find((x) => x.id === id);
    if (!m) throw new Error("NOT_FOUND");
    if (m.deletedAt !== null) throw new Error("MATERIAL_ARCHIVED");
    out.push(m);
  }
  return out;
}

function vendorMaterialDTOs(vendorId: string): Material[] {
  const byId = new Map(loadMaterials().map((m) => [m.id, m]));
  return loadVendorMaterials()
    .filter((l) => l.vendorId === vendorId)
    .map((l) => byId.get(l.materialId))
    .filter((m): m is MaterialRecord => !!m && m.deletedAt === null)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
    .map(toMaterialDTO);
}

/** Every vendor's mapped materials, archived included, built ONCE per call so
 *  the list does not re-read storage per row. Same ordering as the server. */
function demoMaterialRefsByVendor(): Map<string, VendorMaterialRef[]> {
  const byId = new Map(loadMaterials().map((m) => [m.id, m]));
  const grouped = new Map<string, MaterialRecord[]>();
  for (const l of loadVendorMaterials()) {
    const m = byId.get(l.materialId);
    if (!m) continue;
    grouped.set(l.vendorId, [...(grouped.get(l.vendorId) ?? []), m]);
  }
  const out = new Map<string, VendorMaterialRef[]>();
  for (const [vendorId, list] of grouped) {
    out.set(
      vendorId,
      list
        .slice()
        .sort(
          (a, b) =>
            Number(a.deletedAt !== null) - Number(b.deletedAt !== null) ||
            a.displayOrder - b.displayOrder ||
            a.name.localeCompare(b.name),
        )
        .map((m) => ({ id: m.id, name: m.name, isActive: m.deletedAt === null })),
    );
  }
  return out;
}

/** Demo twin of the server's planVendorMaterials — same errors, same rule that
 *  an archived material may be KEPT on a vendor but never newly added. */
function planDemoVendorMaterials(materialIds: string[], currentIds: string[]) {
  const ids = [...new Set(materialIds)];
  const current = new Set(currentIds);
  const byId = new Map(loadMaterials().map((m) => [m.id, m]));
  const rows = ids.map((id) => {
    const m = byId.get(id);
    if (!m) throw new Error("NOT_FOUND");
    if (m.deletedAt !== null && !current.has(id)) throw new Error("MATERIAL_ARCHIVED");
    return m;
  });
  return { ids, names: rows.map((m) => m.name).sort((a, b) => a.localeCompare(b)) };
}

/** Replace a vendor's links and refresh its legacy mirror, as the server does
 *  in one nested write. */
function applyDemoVendorMaterials(vendorId: string, outcome: { ids: string[]; mirror: string[] }) {
  const kept = loadVendorMaterials().filter((l) => l.vendorId !== vendorId);
  write(K.vendorMaterials, [...kept, ...outcome.ids.map((materialId) => ({ vendorId, materialId }))]);
  const vendors = loadVendors();
  const rec = vendors.find((v) => v.id === vendorId);
  if (rec) {
    rec.materialsSupplied = outcome.mirror;
    write(K.vendors, vendors);
  }
}

type DemoMappingState = { column: string[]; current: { id: string; name: string; isActive: boolean }[] };
const EMPTY_DEMO_STATE: DemoMappingState = { column: [], current: [] };

/** A vendor's legacy column + canonical mappings, archived included. */
function demoMappingState(vendorId: string): DemoMappingState {
  const byId = new Map(loadMaterials().map((m) => [m.id, m]));
  const current = loadVendorMaterials()
    .filter((l) => l.vendorId === vendorId)
    .map((l) => byId.get(l.materialId))
    .filter((m): m is MaterialRecord => !!m)
    .map((m) => ({ id: m.id, name: m.name, isActive: m.deletedAt === null }));
  const column = loadVendors().find((v) => v.id === vendorId)?.materialsSupplied ?? [];
  return { column, current };
}

/** New client, as on the server: legacy-only names are carried forward. */
function demoOutcomeFromIds(materialIds: string[], state: DemoMappingState) {
  const plan = planDemoVendorMaterials(materialIds, state.current.map((m) => m.id));
  const extras = unlinkedLegacyNames(state.column, state.current.map((m) => m.name));
  return { ids: plan.ids, mirror: buildMirror(plan.names, extras) };
}

/** Older app: the shared transition rule, exactly as the server applies it. */
function demoOutcomeFromLegacyNames(names: string[], state: DemoMappingState) {
  const plan = planLegacyVendorMaterials({
    submitted: names,
    previousColumn: state.column,
    current: state.current,
    master: loadMaterials().map((m) => ({ id: m.id, name: m.name, isActive: m.deletedAt === null })),
  });
  return { ids: plan.finalIds, mirror: plan.mirror };
}


/** Resolve the materialIds a PO's lines reference, mirroring the server's rules
 *  (including grandfathering an archived material already on the order). */
function resolveDemoLineMaterials(
  lines: { materialId?: string | null }[],
  grandfathered: Set<string> = new Set(),
): Map<string, MaterialRecord> {
  const ids = [...new Set(lines.map((l) => l.materialId).filter((x): x is string => !!x))];
  const rows = loadMaterials();
  const out = new Map<string, MaterialRecord>();
  for (const id of ids) {
    const m = rows.find((x) => x.id === id);
    if (!m) throw new Error("NOT_FOUND");
    if (m.deletedAt !== null && !grandfathered.has(id)) throw new Error("MATERIAL_ARCHIVED");
    out.set(id, m);
  }
  return out;
}

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

/** The demo Material Master as an identity index — built ONCE per call site,
 *  never per PO or per line. Archived rows included: history keeps its bucket. */
function demoMaterialIndex(): Map<string, MaterialIdentityRef> {
  return materialIndex(loadMaterials().map((m) => ({ id: m.id, name: m.name, archived: m.deletedAt !== null })));
}
const NO_MATERIAL_INDEX: ReadonlyMap<string, MaterialIdentityRef> = new Map();

/** `index` labels linked materials; callers that only need money omit it
 *  (identity keys are the same either way — only labels differ). */
function toRollupPO(p: PORecord, index: ReadonlyMap<string, MaterialIdentityRef> = NO_MATERIAL_INDEX): POForRollup {
  return {
    id: p.id,
    vendorId: p.vendorId,
    projectId: p.projectId,
    status: p.status,
    totalPaise: p.totalPaise,
    purchaseDate: p.purchaseDate,
    materials: distinctMaterialLabels(p.lineItems, index),
  };
}
const toRollupPayment = (p: PaymentRecord): PaymentForRollup => p;

function vendorRollup(
  v: VendorRecord,
  pos: PORecord[],
  payments: PaymentRecord[],
  refs: Map<string, VendorMaterialRef[]> = demoMaterialRefsByVendor(),
): Vendor {
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
    materials: refs.get(v.id) ?? [],
    unlinkedMaterialNames: unlinkedLegacyNames(
      v.materialsSupplied,
      (refs.get(v.id) ?? []).map((m) => m.name),
    ),
    paymentTerms: v.paymentTerms,
    status: v.status,
    notes: v.notes,
    isFavorite: v.isFavorite,
    totalPurchasedPaise: counted.reduce((s, p) => s + p.totalPaise, 0),
    outstandingPaise: outstandingPaise(
      pos.map((p) => toRollupPO(p)),
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
    createdBy: { id: po.createdByName, name: po.createdByName },
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
    // `materialId` is absent on PO lines stored before the material master
    // existed. Normalising here is the whole compatibility path: old
    // localStorage data keeps working untouched, and nothing needs rewriting.
    lineItems: po.lineItems.map((l) => ({ ...l, materialId: l.materialId ?? null })),
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

function buildLines(input: CreatePOInput, byId: Map<string, MaterialRecord> = new Map()) {
  return input.lineItems.map((l, i) => ({
    id: uid(),
    // As on the server: a line naming a material takes the master's name, so a
    // client-supplied string can never disagree with the id.
    material: l.materialId ? byId.get(l.materialId)!.name : l.material,
    materialId: l.materialId ?? null,
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
    const refs = demoMaterialRefsByVendor();
    let rows = loadVendors();
    if (filters.status && filters.status !== "ALL") rows = rows.filter((v) => v.status === filters.status);
    // Same rules as the server: the VendorMaterial relation is canonical; the
    // name form (older apps) matches a mapped Material by normalized name, or
    // an unmapped name an older app recorded in the legacy column.
    const material = materialFilterIntent(filters);
    if (material?.kind === "id") {
      rows = rows.filter((v) => (refs.get(v.id) ?? []).some((m) => m.id === material.materialId));
    } else if (material?.kind === "name") {
      const key = normalizeMaterialName(material.name);
      rows = rows.filter(
        (v) =>
          (refs.get(v.id) ?? []).some((m) => normalizeMaterialName(m.name) === key) ||
          v.materialsSupplied.includes(material.name) ||
          v.materialsSupplied.includes(material.name.replace(/\s+/g, " ").trim()),
      );
    }
    if (filters.favoritesOnly) rows = rows.filter((v) => v.isFavorite);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter(
        (v) =>
          v.businessName.toLowerCase().includes(q) ||
          (v.contactPerson ?? "").toLowerCase().includes(q) ||
          (refs.get(v.id) ?? []).some((m) => m.name.toLowerCase().includes(q)),
      );
    }
    return rows
      .sort((a, b) => a.businessName.localeCompare(b.businessName))
      .map((v) => vendorRollup(v, pos, payments, refs));
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
    const index = demoMaterialIndex();
    const rollups = vendorProjectRollups(pos.map((p) => toRollupPO(p, index)), payments.map(toRollupPayment), id, approval);
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
      // Written by the outcome below, as on the server.
      materialsSupplied: [],
      paymentTerms: input.paymentTerms ?? null,
      status: "ACTIVE",
      notes: input.notes ?? null,
      isFavorite: false,
    };
    // Resolve before writing anything, so a bad id leaves no half-made vendor.
    const plan =
      input.materialIds !== undefined
        ? demoOutcomeFromIds(input.materialIds, EMPTY_DEMO_STATE)
        : input.materialsSupplied !== undefined
          ? demoOutcomeFromLegacyNames(input.materialsSupplied, EMPTY_DEMO_STATE)
          : null;
    rows.push(rec);
    write(K.vendors, rows);
    if (plan) applyDemoVendorMaterials(rec.id, plan);
    return vendorRollup(loadVendors().find((v) => v.id === rec.id)!, loadPOs(), loadPayments());
  },

  async updateVendor(id, patch: UpdateVendorInput) {
    const rows = loadVendors();
    const rec = rows.find((v) => v.id === id);
    if (!rec) throw new Error("NOT_FOUND");
    // Neither materials field is stored as-is: both become a mapping outcome,
    // as on the server.
    const { materialIds, materialsSupplied, ...fields } = patch;
    const plan =
      materialIds !== undefined
        ? demoOutcomeFromIds(materialIds, demoMappingState(id))
        : materialsSupplied !== undefined
          ? demoOutcomeFromLegacyNames(materialsSupplied, demoMappingState(id))
          : null;
    Object.assign(rec, fields);
    write(K.vendors, rows);
    if (plan) applyDemoVendorMaterials(id, plan);
    return vendorRollup(loadVendors().find((v) => v.id === id)!, loadPOs(), loadPayments());
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

  async listUnlinkedMaterialNames() {
    return unlinkedRecordedNames(loadPOs().flatMap((p) => p.lineItems));
  },

  async listMembers() {
    return [{ id: ACTOR, fullName: ACTOR }];
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

  /* ── Material master ───────────────────────────────────────────────── */

  async listMaterialMaster(filters: MaterialFilters = {}) {
    let rows = loadMaterials();
    if (!filters.includeArchived) rows = rows.filter((m) => m.deletedAt === null);
    if (filters.category && filters.category !== "ALL")
      rows = rows.filter((m) => m.category === filters.category);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter((m) => m.name.toLowerCase().includes(q));
    }
    return rows
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
      .map(toMaterialDTO);
  },

  async getMaterial(id) {
    const m = loadMaterials().find((x) => x.id === id);
    return m ? toMaterialDTO(m) : null;
  },

  async createMaterial(input: CreateMaterialInput) {
    const name = input.name.trim();
    if (!name) throw new Error("INVALID_NAME");
    assertDemoUnit(input.defaultUnit);
    const rows = loadMaterials();
    if (rows.some((m) => m.deletedAt === null && m.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("MATERIAL_NAME_TAKEN");
    }
    const now = new Date().toISOString();
    const rec: MaterialRecord = {
      id: uid(),
      name,
      category: input.category ?? null,
      defaultUnit: input.defaultUnit || null,
      hsnCode: input.hsnCode || null,
      displayOrder: rows.filter((m) => m.deletedAt === null).length,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    rows.push(rec);
    write(K.materials, rows);
    return toMaterialDTO(rec);
  },

  async updateMaterial(id, patch: UpdateMaterialInput) {
    const rows = loadMaterials();
    const rec = rows.find((m) => m.id === id);
    if (!rec) throw new Error("NOT_FOUND");
    const previousName = rec.name;
    assertDemoUnit(patch.defaultUnit);
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error("INVALID_NAME");
      if (
        rows.some(
          (m) => m.id !== id && m.deletedAt === null && m.name.toLowerCase() === name.toLowerCase(),
        )
      ) {
        throw new Error("MATERIAL_NAME_TAKEN");
      }
      rec.name = name;
    }
    if (patch.category !== undefined) rec.category = patch.category ?? null;
    if (patch.defaultUnit !== undefined) rec.defaultUnit = patch.defaultUnit || null;
    if (patch.hsnCode !== undefined) rec.hsnCode = patch.hsnCode || null;
    if (patch.displayOrder !== undefined) rec.displayOrder = patch.displayOrder;
    rec.updatedAt = new Date().toISOString();
    write(K.materials, rows);
    // As on the server: a rename refreshes the matching entry in each mapped
    // vendor's legacy mirror. PO line snapshots are still left alone.
    if (previousName !== rec.name) {
      const oldKey = normalizeMaterialName(previousName);
      const mapped = new Set(
        loadVendorMaterials().filter((l) => l.materialId === id).map((l) => l.vendorId),
      );
      const vendors = loadVendors();
      for (const v of vendors) {
        if (!mapped.has(v.id)) continue;
        v.materialsSupplied = buildMirror(
          [],
          v.materialsSupplied.map((n) => (normalizeMaterialName(n) === oldKey ? rec.name : n)),
        );
      }
      write(K.vendors, vendors);
    }
    return toMaterialDTO(rec);
  },

  async setMaterialArchived(id, archived) {
    const rows = loadMaterials();
    const rec = rows.find((m) => m.id === id);
    if (!rec) throw new Error("NOT_FOUND");
    if (!archived && rec.deletedAt !== null) {
      if (
        rows.some(
          (m) => m.id !== id && m.deletedAt === null && m.name.toLowerCase() === rec.name.toLowerCase(),
        )
      ) {
        throw new Error("MATERIAL_NAME_TAKEN");
      }
    }
    rec.deletedAt = archived ? new Date().toISOString() : null;
    rec.updatedAt = new Date().toISOString();
    write(K.materials, rows);
    return toMaterialDTO(rec);
  },

  /* ── Vendor to material links ──────────────────────────────────────── */

  async listVendorMaterials(vendorId) {
    assertDemoVendor(vendorId);
    return vendorMaterialDTOs(vendorId);
  },

  async setVendorMaterials(vendorId, materialIds) {
    assertDemoVendor(vendorId);
    applyDemoVendorMaterials(vendorId, demoOutcomeFromIds(materialIds, demoMappingState(vendorId)));
    return vendorMaterialDTOs(vendorId);
  },

  async addMaterialToVendor(vendorId, materialId) {
    assertDemoVendor(vendorId);
    resolveDemoActiveMaterials([materialId]);
    const links = loadVendorMaterials();
    // Idempotent: re-adding an existing link changes nothing.
    if (!links.some((l) => l.vendorId === vendorId && l.materialId === materialId)) {
      const state = demoMappingState(vendorId);
      applyDemoVendorMaterials(
        vendorId,
        demoOutcomeFromIds([...state.current.map((m) => m.id), materialId], state),
      );
    }
    return vendorMaterialDTOs(vendorId);
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
    // Material: identity (materialId) or the recorded-name compatibility path —
    // the same rule as the server (material-identity.ts).
    const material = materialFilterIntent(filters);
    if (material?.kind === "id")
      rows = rows.filter((p) => p.lineItems.some((l) => l.materialId === material.materialId));
    else if (material?.kind === "name")
      rows = rows.filter((p) => p.lineItems.some((l) => matchesRecordedName(l.material, material.name)));
    if (filters.category && filters.category !== "ALL")
      rows = rows.filter((p) => p.lineItems.some((l) => l.category === filters.category));
    if (filters.createdById && filters.createdById !== "ALL")
      rows = rows.filter((p) => p.createdByName === filters.createdById);
    if (filters.gst === "WITH") rows = rows.filter((p) => p.gstPaise > 0);
    if (filters.gst === "WITHOUT") rows = rows.filter((p) => p.gstPaise === 0);
    if (filters.amountMinPaise != null) rows = rows.filter((p) => p.totalPaise >= filters.amountMinPaise!);
    if (filters.amountMaxPaise != null) rows = rows.filter((p) => p.totalPaise <= filters.amountMaxPaise!);
    if (filters.dateFrom) rows = rows.filter((p) => p.purchaseDate >= filters.dateFrom!);
    if (filters.dateTo) rows = rows.filter((p) => p.purchaseDate <= filters.dateTo!);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const index = demoMaterialIndex();
      rows = rows.filter(
        (p) =>
          p.poNumber.toLowerCase().includes(q) ||
          (vendors.find((v) => v.id === p.vendorId)?.businessName ?? "").toLowerCase().includes(q) ||
          p.lineItems.some(
            (l) =>
              l.material.toLowerCase().includes(q) ||
              (!!l.materialId && (index.get(l.materialId)?.name.toLowerCase().includes(q) ?? false)),
          ),
      );
    }
    let items = rows
      .map((p) => toListItem(p, vendors, meta, paid))
      .sort(poComparator(filters.sort));
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
    // A new order may only name live materials. No vendor-mapping check: the
    // mapping is a convenience catalogue, never an ordering constraint.
    const lineItems = buildLines(input, resolveDemoLineMaterials(input.lineItems));
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
    // Lines are rebuilt wholesale, so materialId has to be carried through — and
    // a material archived since this order was raised stays usable on it.
    const grandfathered = new Set(
      rec.lineItems.map((l) => l.materialId).filter((x): x is string => !!x),
    );
    const lineItems = buildLines(input, resolveDemoLineMaterials(input.lineItems, grandfathered));
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
    // Demo actor is the owner; permanently remove the PO (line items are
    // embedded in the record, so they go with it).
    const pos = loadPOs();
    if (!pos.some((p) => p.id === id)) throw new Error("NOT_FOUND");
    // Parity with the server: an order with payments recorded against it stays.
    // Deleting it would leave the cash in place with nothing it was paid for.
    if (loadPayments().some((pay) => pay.purchaseOrderId === id)) {
      throw new Error("PO_HAS_PAYMENTS");
    }
    write(K.pos, pos.filter((p) => p.id !== id));
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

  async deletePayment(): Promise<never> {
    // Parity with the server: a recorded vendor payment is cash that moved, and
    // deleting it would take that movement out of the Payments centre and every
    // report. See features/governance/delete-policy.ts.
    throw new Error("VENDOR_PAYMENT_IMMUTABLE");
  },

  /* ── Project-aware views ───────────────────────────────────────────── */

  async getProjectProcurement(projectId) {
    const pos = loadPOs();
    const payments = loadPayments();
    const vendors = loadVendors();
    const meta = projectMeta();
    const approval = demoApprovalRequired();
    const index = demoMaterialIndex();
    const rollupPOs = pos.map((p) => toRollupPO(p, index));
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
      pos.map((p) => toRollupPO(p)),
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
    // As on the server: a duplicate (a NEW order) drops the id of a material
    // archived since, keeping the line's name; a revise keeps everything.
    lineItems: src.lineItems.map((l) => {
      const archived =
        !opts.linkRevision &&
        !!l.materialId &&
        loadMaterials().some((m) => m.id === l.materialId && m.deletedAt !== null);
      return { ...l, id: uid(), materialId: archived ? null : (l.materialId ?? null) };
    }),
  };
  pos.push(copy);
  write(K.pos, pos);
  return toDetail(copy, loadVendors(), pos, loadPayments(), projectMeta());
}
