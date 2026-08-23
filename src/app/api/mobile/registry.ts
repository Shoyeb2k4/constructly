import "server-only";
import { requireUser } from "@/lib/auth/current-user";
import * as projects from "@/features/projects/server/actions";
import { gatherServerDashboard } from "@/features/dashboard/server/gather";
import { gatherServerPayments } from "@/features/payments/server/gather";
import * as budget from "@/features/budget/server-actions";
import * as agreements from "@/features/contracts/server/actions";
import * as amendments from "@/features/contracts/server/amendments";
import * as attribution from "@/features/contracts/server/attribution";
import * as branding from "@/features/branding/server/actions";
import * as contractScope from "@/features/contracts/server/scope";
import * as contractorActions from "@/features/contractors/server/actions";
import * as contractorRescope from "@/features/contractors/server/advance-rescope";
import * as labor from "@/features/labor/server/actions";
import * as milestones from "@/features/contracts/server/milestones";
import * as procurement from "@/features/procurement/server/actions";
import * as reconciliation from "@/features/contracts/server/reconciliation";
import * as roles from "@/features/rbac/server/roles-actions";
import * as team from "@/features/team/server/actions";
import type {
  CreateProjectInput,
  ProjectContractorInput,
  ProjectFilters,
  ProjectStage,
  UpdateProjectInput,
} from "@/features/projects/types";

/**
 * The mobile RPC allowlist.
 *
 * SECURITY — this file is a STATIC allowlist, deliberately verbose. A method is
 * callable only if it is written out below by hand. There is no
 * `(actions as never)[method]` lookup, no dynamic `import(feature)`, and no
 * re-export of a module's namespace: a request cannot reach a server function
 * that an author did not explicitly list here, even if that function is
 * exported from the same module. Adding a capability is always an intentional
 * code change reviewable in a diff.
 *
 * Authorization is NOT re-implemented here. Every listed function already calls
 * `requirePermission(...)` / `requireProjectWrite(...)` internally, and the
 * route runs them under the caller's real resolved session — so the mobile app
 * gets byte-identical RBAC to the web app, from the same code.
 *
 * ARGUMENTS ARE NOT A SECURITY BOUNDARY, and are not treated as one here. The
 * boundary is WHICH FUNCTIONS ARE REACHABLE — that is what this file decides.
 * What may be passed to a reachable function is decided by that function, which
 * validates its own input with zod and resolves its own tenant from the
 * session, exactly as it does when the web app invokes it as a Server Action.
 * The `Parameters<typeof …>` casts below therefore document each entry's real
 * signature rather than enforcing it; the route caps the array at 8 elements and
 * the action rejects anything malformed.
 */
type RpcMethod = (args: unknown[]) => Promise<unknown>;

/** Actions taking `FormData`, performing `redirect()`, or otherwise unsuited to
 *  a JSON transport are intentionally absent (e.g. document byte uploads, which
 *  will use a dedicated signed-URL flow on mobile). */
const projectMethods: Record<string, RpcMethod> = {
  list: (a) => projects.listProjects(a[0] as ProjectFilters | undefined),
  get: (a) => projects.getProject(a[0] as string),
  create: (a) => projects.createProject(a[0] as CreateProjectInput),
  update: (a) => projects.updateProject(a[0] as string, a[1] as UpdateProjectInput),
  changeStage: (a) => projects.changeStage(a[0] as string, a[1] as ProjectStage),
  assignManager: (a) => projects.assignManager(a[0] as string, a[1] as string | null),
  duplicate: (a) => projects.duplicateProject(a[0] as string),
  setArchived: (a) => projects.setArchived(a[0] as string, a[1] as boolean),
  remove: (a) =>
    projects.removeProject(a[0] as string, a[1] as { password: string; reason?: string | null }),
  restore: (a) => projects.restoreProject(a[0] as string),
  getRetention: () => projects.getProjectRetention(),
  setRetention: (a) => projects.setProjectRetention(a[0] as number | null),
  toggleFavorite: (a) => projects.toggleFavorite(a[0] as string),
  addDeadline: (a) => projects.addDeadline(a[0] as string, a[1] as string, a[2] as string),
  toggleDeadline: (a) => projects.toggleDeadline(a[0] as string, a[1] as string),
  removeDeadline: (a) => projects.removeDeadline(a[0] as string, a[1] as string),
  addNote: (a) => projects.addNote(a[0] as string, a[1] as string),
  addDocument: (a) =>
    projects.addDocument(
      a[0] as string,
      a[1] as { filename: string; sizeBytes: number; mimeType: string },
    ),
  removeDocument: (a) => projects.removeDocument(a[0] as string, a[1] as string),
  listManagers: () => projects.listManagers(),
  listProjectContractors: (a) => projects.listProjectContractors(a[0] as string),
  setProjectContractors: (a) =>
    projects.setProjectContractors(a[0] as string, a[1] as ProjectContractorInput[]),
};

/**
 * The web app receives the session from the server layout as props. The native
 * app has no server render, so it asks for it once at boot — same
 * `SessionUser`, same permission resolution, same source function.
 */
const sessionMethods: Record<string, RpcMethod> = {
  me: () => requireUser(),
};

/**
 * The dashboard is the app's landing screen, so it is registered alongside
 * projects rather than left for the later feature sweep.
 *
 * Read-only and argument-free: `gatherServerDashboard` derives the company and
 * the owner flag from the resolved session itself, so a caller cannot ask for
 * another tenant's overview by passing a different id — there is no id to pass.
 */
const dashboardMethods: Record<string, RpcMethod> = {
  gather: () => gatherServerDashboard(),
};

/** Contractors — profiles, advances, ledger and settlements. */
const contractorsMethods: Record<string, RpcMethod> = {
  listContractors: (a) => contractorActions.listContractors(...(a as Parameters<typeof contractorActions.listContractors>)),
  getContractor: (a) => contractorActions.getContractor(...(a as Parameters<typeof contractorActions.getContractor>)),
  createContractor: (a) => contractorActions.createContractor(...(a as Parameters<typeof contractorActions.createContractor>)),
  findContractorDuplicates: (a) => contractorActions.findContractorDuplicates(...(a as Parameters<typeof contractorActions.findContractorDuplicates>)),
  archiveContractor: (a) => contractorActions.archiveContractor(...(a as Parameters<typeof contractorActions.archiveContractor>)),
  restoreContractor: (a) => contractorActions.restoreContractor(...(a as Parameters<typeof contractorActions.restoreContractor>)),
  updateContractor: (a) => contractorActions.updateContractor(...(a as Parameters<typeof contractorActions.updateContractor>)),
  recordAdvance: (a) => contractorActions.recordAdvance(...(a as Parameters<typeof contractorActions.recordAdvance>)),
  previewAdvanceRescope: (a) => contractorRescope.previewAdvanceRescope(...(a as Parameters<typeof contractorRescope.previewAdvanceRescope>)),
  rescopeAdvance: (a) => contractorRescope.rescopeAdvance(...(a as Parameters<typeof contractorRescope.rescopeAdvance>)),
  reverseAdvanceRescope: (a) => contractorRescope.reverseAdvanceRescope(...(a as Parameters<typeof contractorRescope.reverseAdvanceRescope>)),

  getLedger: (a) => contractorActions.getLedger(...(a as Parameters<typeof contractorActions.getLedger>)),
  previewSettlement: (a) => contractorActions.previewSettlement(...(a as Parameters<typeof contractorActions.previewSettlement>)),
  createSettlement: (a) => contractorActions.createSettlement(...(a as Parameters<typeof contractorActions.createSettlement>)),
  reverseSettlement: (a) => contractorActions.reverseSettlement(...(a as Parameters<typeof contractorActions.reverseSettlement>)),
  listSettlements: (a) => contractorActions.listSettlements(...(a as Parameters<typeof contractorActions.listSettlements>)),
  outstandingAdvances: (a) => contractorActions.outstandingAdvances(...(a as Parameters<typeof contractorActions.outstandingAdvances>)),
  contractorCostSummary: (a) => contractorActions.contractorCostSummary(...(a as Parameters<typeof contractorActions.contractorCostSummary>)),
};

/** Contractor commercial agreements — scope, milestones, amendments, attribution. */
const contractsMethods: Record<string, RpcMethod> = {
  listContracts: (a) => agreements.listContracts(...(a as Parameters<typeof agreements.listContracts>)),
  getContract: (a) => agreements.getContract(...(a as Parameters<typeof agreements.getContract>)),
  createContract: (a) => agreements.createContract(...(a as Parameters<typeof agreements.createContract>)),
  updateContract: (a) => agreements.updateContract(...(a as Parameters<typeof agreements.updateContract>)),
  setContractStatus: (a) => agreements.setContractStatus(...(a as Parameters<typeof agreements.setContractStatus>)),
  cancelContract: (a) => agreements.cancelContract(...(a as Parameters<typeof agreements.cancelContract>)),
  deleteContract: (a) => agreements.deleteContract(...(a as Parameters<typeof agreements.deleteContract>)),

  listScopeItems: (a) => contractScope.listScopeItems(...(a as Parameters<typeof contractScope.listScopeItems>)),
  addScopeItem: (a) => contractScope.addScopeItem(...(a as Parameters<typeof contractScope.addScopeItem>)),
  removeScopeItem: (a) => contractScope.removeScopeItem(...(a as Parameters<typeof contractScope.removeScopeItem>)),
  listRateRevisions: (a) => contractScope.listRateRevisions(...(a as Parameters<typeof contractScope.listRateRevisions>)),
  setScopeRate: (a) => contractScope.setScopeRate(...(a as Parameters<typeof contractScope.setScopeRate>)),

  listMilestones: (a) => milestones.listMilestones(...(a as Parameters<typeof milestones.listMilestones>)),
  createMilestone: (a) => milestones.createMilestone(...(a as Parameters<typeof milestones.createMilestone>)),
  createMilestonesBulk: (a) => milestones.createMilestonesBulk(...(a as Parameters<typeof milestones.createMilestonesBulk>)),
  updateMilestone: (a) => milestones.updateMilestone(...(a as Parameters<typeof milestones.updateMilestone>)),
  reorderMilestones: (a) => milestones.reorderMilestones(...(a as Parameters<typeof milestones.reorderMilestones>)),
  setMilestoneStatus: (a) => milestones.setMilestoneStatus(...(a as Parameters<typeof milestones.setMilestoneStatus>)),
  deleteMilestone: (a) => milestones.deleteMilestone(...(a as Parameters<typeof milestones.deleteMilestone>)),

  listAmendments: (a) => amendments.listAmendments(...(a as Parameters<typeof amendments.listAmendments>)),
  proposeAmendment: (a) => amendments.proposeAmendment(...(a as Parameters<typeof amendments.proposeAmendment>)),
  approveAmendment: (a) => amendments.approveAmendment(...(a as Parameters<typeof amendments.approveAmendment>)),
  rejectAmendment: (a) => amendments.rejectAmendment(...(a as Parameters<typeof amendments.rejectAmendment>)),

  recordContractPayment: (a) => agreements.recordContractPayment(...(a as Parameters<typeof agreements.recordContractPayment>)),
  reverseContractPayment: (a) => agreements.reverseContractPayment(...(a as Parameters<typeof agreements.reverseContractPayment>)),

  listAttributableLabour: (a) => attribution.listAttributableLabour(...(a as Parameters<typeof attribution.listAttributableLabour>)),
  previewAttribution: (a) => attribution.previewAttribution(...(a as Parameters<typeof attribution.previewAttribution>)),
  attributeSettledLabour: (a) => attribution.attributeSettledLabour(...(a as Parameters<typeof attribution.attributeSettledLabour>)),
  reverseAttribution: (a) => attribution.reverseAttribution(...(a as Parameters<typeof attribution.reverseAttribution>)),

  listHistory: (a) => reconciliation.listHistory(...(a as Parameters<typeof reconciliation.listHistory>)),
  getContractorProfile: (a) => reconciliation.getContractorProfile(...(a as Parameters<typeof reconciliation.getContractorProfile>)),
  projectContractsSummary: (a) => reconciliation.projectContractorsCommercialSummary(...(a as Parameters<typeof reconciliation.projectContractorsCommercialSummary>)),
};

/** Labour categories and daily attendance. */
const laborMethods: Record<string, RpcMethod> = {
  listCategories: (a) => labor.listCategories(...(a as Parameters<typeof labor.listCategories>)),
  createCategory: (a) => labor.createCategory(...(a as Parameters<typeof labor.createCategory>)),
  updateCategory: (a) => labor.updateCategory(...(a as Parameters<typeof labor.updateCategory>)),
  deleteCategory: (a) => labor.deleteCategory(...(a as Parameters<typeof labor.deleteCategory>)),
  reorderCategories: (a) => labor.reorderCategories(...(a as Parameters<typeof labor.reorderCategories>)),
  createSubcategory: (a) => labor.createSubcategory(...(a as Parameters<typeof labor.createSubcategory>)),
  updateSubcategory: (a) => labor.updateSubcategory(...(a as Parameters<typeof labor.updateSubcategory>)),
  deleteSubcategory: (a) => labor.deleteSubcategory(...(a as Parameters<typeof labor.deleteSubcategory>)),
  reorderSubcategories: (a) => labor.reorderSubcategories(...(a as Parameters<typeof labor.reorderSubcategories>)),
  forceDeletePreview: (a) => labor.forceDeletePreview(...(a as Parameters<typeof labor.forceDeletePreview>)),
  forceDeleteCategory: (a) => labor.forceDeleteCategory(...(a as Parameters<typeof labor.forceDeleteCategory>)),
  forceDeleteSubcategory: (a) => labor.forceDeleteSubcategory(...(a as Parameters<typeof labor.forceDeleteSubcategory>)),
  getSheet: (a) => labor.getSheet(...(a as Parameters<typeof labor.getSheet>)),
  setQuantity: (a) => labor.setQuantity(...(a as Parameters<typeof labor.setQuantity>)),
  copyPreviousDay: (a) => labor.copyPreviousDay(...(a as Parameters<typeof labor.copyPreviousDay>)),
  listAttendance: (a) => labor.listAttendance(...(a as Parameters<typeof labor.listAttendance>)),
  summary: (a) => labor.summary(...(a as Parameters<typeof labor.summary>)),
};

/** Vendors, purchase orders and procurement payments. */
const procurementMethods: Record<string, RpcMethod> = {
  listVendors: (a) => procurement.listVendors(...(a as Parameters<typeof procurement.listVendors>)),
  getVendor: (a) => procurement.getVendor(...(a as Parameters<typeof procurement.getVendor>)),
  createVendor: (a) => procurement.createVendor(...(a as Parameters<typeof procurement.createVendor>)),
  updateVendor: (a) => procurement.updateVendor(...(a as Parameters<typeof procurement.updateVendor>)),
  setVendorStatus: (a) => procurement.setVendorStatus(...(a as Parameters<typeof procurement.setVendorStatus>)),
  toggleVendorFavorite: (a) => procurement.toggleVendorFavorite(...(a as Parameters<typeof procurement.toggleVendorFavorite>)),
  listMaterials: (a) => procurement.listMaterials(...(a as Parameters<typeof procurement.listMaterials>)),
  listMembers: (a) => procurement.listMembers(...(a as Parameters<typeof procurement.listMembers>)),
  addVendorDocument: (a) => procurement.addVendorDocument(...(a as Parameters<typeof procurement.addVendorDocument>)),
  removeVendorDocument: (a) => procurement.removeVendorDocument(...(a as Parameters<typeof procurement.removeVendorDocument>)),
  listMaterialCategories: (a) => procurement.listMaterialCategories(...(a as Parameters<typeof procurement.listMaterialCategories>)),
  setMaterialCategories: (a) => procurement.setMaterialCategories(...(a as Parameters<typeof procurement.setMaterialCategories>)),
  listPurchaseOrders: (a) => procurement.listPurchaseOrders(...(a as Parameters<typeof procurement.listPurchaseOrders>)),
  getPurchaseOrder: (a) => procurement.getPurchaseOrder(...(a as Parameters<typeof procurement.getPurchaseOrder>)),
  createPurchaseOrder: (a) => procurement.createPurchaseOrder(...(a as Parameters<typeof procurement.createPurchaseOrder>)),
  updatePurchaseOrder: (a) => procurement.updatePurchaseOrder(...(a as Parameters<typeof procurement.updatePurchaseOrder>)),
  submitPurchaseOrder: (a) => procurement.submitPurchaseOrder(...(a as Parameters<typeof procurement.submitPurchaseOrder>)),
  approvePurchaseOrder: (a) => procurement.approvePurchaseOrder(...(a as Parameters<typeof procurement.approvePurchaseOrder>)),
  revisePurchaseOrder: (a) => procurement.revisePurchaseOrder(...(a as Parameters<typeof procurement.revisePurchaseOrder>)),
  duplicatePurchaseOrder: (a) => procurement.duplicatePurchaseOrder(...(a as Parameters<typeof procurement.duplicatePurchaseOrder>)),
  deletePurchaseOrder: (a) => procurement.deletePurchaseOrder(...(a as Parameters<typeof procurement.deletePurchaseOrder>)),
  pendingApprovalCount: (a) => procurement.pendingApprovalCount(...(a as Parameters<typeof procurement.pendingApprovalCount>)),
  listPayments: (a) => procurement.listPayments(...(a as Parameters<typeof procurement.listPayments>)),
  createPayment: (a) => procurement.createPayment(...(a as Parameters<typeof procurement.createPayment>)),
  deletePayment: (a) => procurement.deletePayment(...(a as Parameters<typeof procurement.deletePayment>)),
  getProjectProcurement: (a) => procurement.getProjectProcurement(...(a as Parameters<typeof procurement.getProjectProcurement>)),
  vendorAging: (a) => procurement.vendorAging(...(a as Parameters<typeof procurement.vendorAging>)),
};

/** Team membership and invitations. */
const teamMethods: Record<string, RpcMethod> = {
  listMembers: (a) => team.listMembers(...(a as Parameters<typeof team.listMembers>)),
  listInvitations: (a) => team.listInvitations(...(a as Parameters<typeof team.listInvitations>)),
  inviteMember: (a) => team.inviteMember(...(a as Parameters<typeof team.inviteMember>)),
  resendInvitation: (a) => team.resendInvitation(...(a as Parameters<typeof team.resendInvitation>)),
  cancelInvitation: (a) => team.cancelInvitation(...(a as Parameters<typeof team.cancelInvitation>)),
  changeMemberRole: (a) => team.changeMemberRole(...(a as Parameters<typeof team.changeMemberRole>)),
  setMemberStatus: (a) => team.setMemberStatus(...(a as Parameters<typeof team.setMemberStatus>)),
  removeMember: (a) => team.removeMember(...(a as Parameters<typeof team.removeMember>)),
};

/** Roles and permission sets. */
const rbacMethods: Record<string, RpcMethod> = {
  listRoles: (a) => roles.listRoles(...(a as Parameters<typeof roles.listRoles>)),
  listAssignableRoles: (a) => roles.listAssignableRoles(...(a as Parameters<typeof roles.listAssignableRoles>)),
  createRole: (a) => roles.createRole(...(a as Parameters<typeof roles.createRole>)),
  duplicateRole: (a) => roles.duplicateRole(...(a as Parameters<typeof roles.duplicateRole>)),
  updateRole: (a) => roles.updateRole(...(a as Parameters<typeof roles.updateRole>)),
  deleteRole: (a) => roles.deleteRole(...(a as Parameters<typeof roles.deleteRole>)),
  assignUserRole: (a) => roles.assignUserRole(...(a as Parameters<typeof roles.assignUserRole>)),
};

/** Company branding and the signed-in user's profile. */
const brandingMethods: Record<string, RpcMethod> = {
  getCompanyBranding: (a) => branding.getCompanyBranding(...(a as Parameters<typeof branding.getCompanyBranding>)),
  updateCompanyProfile: (a) => branding.updateCompanyProfile(...(a as Parameters<typeof branding.updateCompanyProfile>)),
  updateBrandColors: (a) => branding.updateBrandColors(...(a as Parameters<typeof branding.updateBrandColors>)),
  getProfile: (a) => branding.getProfile(...(a as Parameters<typeof branding.getProfile>)),
  updateProfile: (a) => branding.updateProfile(...(a as Parameters<typeof branding.updateProfile>)),
  getBrandingAssetUrls: (a) => branding.getBrandingAssetUrls(...(a as Parameters<typeof branding.getBrandingAssetUrls>)),
  getProfileAssetUrls: (a) => branding.getProfileAssetUrls(...(a as Parameters<typeof branding.getProfileAssetUrls>)),
  removeBrandingAsset: (a) => branding.removeBrandingAsset(...(a as Parameters<typeof branding.removeBrandingAsset>)),
  getPdfBrandingData: (a) => branding.getPdfBrandingData(...(a as Parameters<typeof branding.getPdfBrandingData>)),
};

/**
 * The Payments Centre snapshot for one period.
 *
 * Takes the period bounds only. Visibility and tenant are derived from the
 * resolved session inside the gather, so there is no parameter through which a
 * caller could ask to see a wider scope than their role allows.
 */
const paymentsMethods: Record<string, RpcMethod> = {
  gather: (a) => gatherServerPayments(...(a as Parameters<typeof gatherServerPayments>)),
};

/** Derived project spend. Read-only. */
const budgetMethods: Record<string, RpcMethod> = {
  projectSpend: (a) => budget.projectSpend(...(a as Parameters<typeof budget.projectSpend>)),
  spendByProject: () => budget.spendByProject(),
};

const REGISTRY: Record<string, Record<string, RpcMethod>> = {
  session: sessionMethods,
  dashboard: dashboardMethods,
  projects: projectMethods,
  contractors: contractorsMethods,
  contracts: contractsMethods,
  labor: laborMethods,
  procurement: procurementMethods,
  team: teamMethods,
  rbac: rbacMethods,
  branding: brandingMethods,
  payments: paymentsMethods,
  budget: budgetMethods,
};

/**
 * Resolve a registered method, or null. Uses own-property checks so inherited
 * keys (`__proto__`, `constructor`, `toString`, …) can never resolve to a
 * callable.
 */
export function lookupRpcMethod(feature: string, method: string): RpcMethod | null {
  if (!Object.prototype.hasOwnProperty.call(REGISTRY, feature)) return null;
  const methods = REGISTRY[feature];
  if (!Object.prototype.hasOwnProperty.call(methods, method)) return null;
  return methods[method];
}
