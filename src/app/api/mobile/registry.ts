import "server-only";
import { requireUser } from "@/lib/auth/current-user";
import * as projects from "@/features/projects/server/actions";
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
 * Phase 1 registers the `projects` feature only. The remaining six features are
 * mechanical additions in a later phase.
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

const REGISTRY: Record<string, Record<string, RpcMethod>> = {
  session: sessionMethods,
  projects: projectMethods,
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
