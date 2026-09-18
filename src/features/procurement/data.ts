import { isDemoMode } from "@/lib/env";
import { isNativeClient } from "@/lib/mobile/platform";
import type { ProcurementRepository } from "./repository";
import { demoProcurementRepository } from "./demo/demo-repository";
import { httpProcurementRepository } from "./http-repository";
import * as server from "./server/actions";
import type { MaterialFilters, PaymentFilters, POFilters, VendorFilters } from "./types";

const serverRepository: ProcurementRepository = {
  listVendors: server.listVendors,
  getVendor: server.getVendor,
  createVendor: server.createVendor,
  updateVendor: server.updateVendor,
  setVendorStatus: server.setVendorStatus,
  toggleVendorFavorite: server.toggleVendorFavorite,
  listMaterials: server.listMaterials,
  listUnlinkedMaterialNames: server.listUnlinkedMaterialNames,
  listMembers: server.listMembers,
  addVendorDocument: server.addVendorDocument,
  removeVendorDocument: server.removeVendorDocument,
  listMaterialCategories: server.listMaterialCategories,
  setMaterialCategories: server.setMaterialCategories,
  listMaterialMaster: server.listMaterialMaster,
  getMaterial: server.getMaterial,
  createMaterial: server.createMaterial,
  updateMaterial: server.updateMaterial,
  setMaterialArchived: server.setMaterialArchived,
  listVendorMaterials: server.listVendorMaterials,
  setVendorMaterials: server.setVendorMaterials,
  addMaterialToVendor: server.addMaterialToVendor,
  listPurchaseOrders: server.listPurchaseOrders,
  getPurchaseOrder: server.getPurchaseOrder,
  createPurchaseOrder: server.createPurchaseOrder,
  updatePurchaseOrder: server.updatePurchaseOrder,
  submitPurchaseOrder: server.submitPurchaseOrder,
  approvePurchaseOrder: server.approvePurchaseOrder,
  revisePurchaseOrder: server.revisePurchaseOrder,
  duplicatePurchaseOrder: server.duplicatePurchaseOrder,
  deletePurchaseOrder: server.deletePurchaseOrder,
  pendingApprovalCount: server.pendingApprovalCount,
  listPayments: server.listPayments,
  createPayment: server.createPayment,
  deletePayment: server.deletePayment,
  getProjectProcurement: server.getProjectProcurement,
  vendorAging: server.vendorAging,
};

/**
 * Transport selection, in priority order:
 *   demo mode  → in-browser fixtures (unchanged)
 *   native app → HTTP RPC to the deployed Next backend (Capacitor; no Server
 *                Actions, because the bundle has no same-origin Next server)
 *   web        → Server Actions (unchanged — this is the production path)
 *
 * `isNativeClient` is a build-time constant, so each bundle keeps exactly one
 * of these branches and tree-shakes the rest: the web bundle never carries the
 * RPC client, and the mobile bundle never carries Prisma.
 */
export const procurementApi: ProcurementRepository = isDemoMode
  ? demoProcurementRepository
  : isNativeClient
    ? httpProcurementRepository
    : serverRepository;

export const procurementKeys = {
  all: ["procurement"] as const,
  vendors: (f?: VendorFilters) => ["procurement", "vendors", f ?? {}] as const,
  vendor: (id: string) => ["procurement", "vendor", id] as const,
  vendorAging: (id: string, projectId?: string) => ["procurement", "vendor-aging", id, projectId ?? null] as const,
  /** LEGACY name list — older apps only (see ProcurementRepository.listMaterials). */
  materials: ["procurement", "materials"] as const,
  unlinkedMaterialNames: ["procurement", "unlinked-material-names"] as const,
  members: ["procurement", "members"] as const,
  materialCategories: ["procurement", "material-categories"] as const,
  // Material master. Pass 4+ UI must invalidate:
  //   create / edit / archive / restore -> materialMaster, material(id), materials
  //   vendor mapping change             -> vendorMaterials(vendorId), vendor(id)
  // `materials` is included because the transitional name list is derived from
  // the master (see ProcurementRepository.listMaterials).
  materialMaster: (f?: MaterialFilters) => ["procurement", "material-master", f ?? {}] as const,
  material: (id: string) => ["procurement", "material", id] as const,
  vendorMaterials: (vendorId: string) => ["procurement", "vendor-materials", vendorId] as const,
  pos: (f?: POFilters) => ["procurement", "pos", f ?? {}] as const,
  po: (id: string) => ["procurement", "po", id] as const,
  payments: (f?: PaymentFilters) => ["procurement", "payments", f ?? {}] as const,
  projectProcurement: (projectId: string) => ["procurement", "project", projectId] as const,
  pendingApprovals: ["procurement", "pending-approvals"] as const,
};
