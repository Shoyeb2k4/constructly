import { isDemoMode } from "@/lib/env";
import type { ProcurementRepository } from "./repository";
import { demoProcurementRepository } from "./demo/demo-repository";
import * as server from "./server/actions";
import type { PaymentFilters, POFilters, VendorFilters } from "./types";

const serverRepository: ProcurementRepository = {
  listVendors: server.listVendors,
  getVendor: server.getVendor,
  createVendor: server.createVendor,
  updateVendor: server.updateVendor,
  setVendorStatus: server.setVendorStatus,
  toggleVendorFavorite: server.toggleVendorFavorite,
  listMaterials: server.listMaterials,
  listMembers: server.listMembers,
  addVendorDocument: server.addVendorDocument,
  removeVendorDocument: server.removeVendorDocument,
  listMaterialCategories: server.listMaterialCategories,
  setMaterialCategories: server.setMaterialCategories,
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

export const procurementApi: ProcurementRepository = isDemoMode
  ? demoProcurementRepository
  : serverRepository;

export const procurementKeys = {
  all: ["procurement"] as const,
  vendors: (f?: VendorFilters) => ["procurement", "vendors", f ?? {}] as const,
  vendor: (id: string) => ["procurement", "vendor", id] as const,
  vendorAging: (id: string, projectId?: string) => ["procurement", "vendor-aging", id, projectId ?? null] as const,
  materials: ["procurement", "materials"] as const,
  members: ["procurement", "members"] as const,
  materialCategories: ["procurement", "material-categories"] as const,
  pos: (f?: POFilters) => ["procurement", "pos", f ?? {}] as const,
  po: (id: string) => ["procurement", "po", id] as const,
  payments: (f?: PaymentFilters) => ["procurement", "payments", f ?? {}] as const,
  projectProcurement: (projectId: string) => ["procurement", "project", projectId] as const,
  pendingApprovals: ["procurement", "pending-approvals"] as const,
};
