import { isDemoMode } from "@/lib/env";
import type { ProcurementRepository } from "./repository";
import { demoProcurementRepository } from "./demo/demo-repository";
import * as server from "./server/actions";
import type { POFilters, VendorFilters } from "./types";

const serverRepository: ProcurementRepository = {
  listVendors: server.listVendors,
  getVendor: server.getVendor,
  createVendor: server.createVendor,
  updateVendor: server.updateVendor,
  setVendorStatus: server.setVendorStatus,
  toggleVendorFavorite: server.toggleVendorFavorite,
  listMaterials: server.listMaterials,
  listPurchaseOrders: server.listPurchaseOrders,
  getPurchaseOrder: server.getPurchaseOrder,
  createPurchaseOrder: server.createPurchaseOrder,
  updatePurchaseOrder: server.updatePurchaseOrder,
  submitPurchaseOrder: server.submitPurchaseOrder,
  approvePurchaseOrder: server.approvePurchaseOrder,
  revisePurchaseOrder: server.revisePurchaseOrder,
  deletePurchaseOrder: server.deletePurchaseOrder,
  pendingApprovalCount: server.pendingApprovalCount,
};

export const procurementApi: ProcurementRepository = isDemoMode
  ? demoProcurementRepository
  : serverRepository;

export const procurementKeys = {
  all: ["procurement"] as const,
  vendors: (f?: VendorFilters) => ["procurement", "vendors", f ?? {}] as const,
  vendor: (id: string) => ["procurement", "vendor", id] as const,
  materials: ["procurement", "materials"] as const,
  pos: (f?: POFilters) => ["procurement", "pos", f ?? {}] as const,
  po: (id: string) => ["procurement", "po", id] as const,
  pendingApprovals: ["procurement", "pending-approvals"] as const,
};
