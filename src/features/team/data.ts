import { isDemoMode } from "@/lib/env";
import { isNativeClient } from "@/lib/mobile/platform";
import { demoTeamRepository } from "./demo/demo-repository";
import { httpTeamRepository } from "./http-repository";
import type { TeamRepository } from "./repository";
import * as server from "./server/actions";

/** Demo binds to localStorage; everything else to the Prisma server actions. */
const serverRepository: TeamRepository = {
  listMembers: server.listMembers,
  listInvitations: server.listInvitations,
  inviteMember: server.inviteMember,
  resendInvitation: server.resendInvitation,
  cancelInvitation: server.cancelInvitation,
  changeMemberRole: server.changeMemberRole,
  setMemberStatus: server.setMemberStatus,
  removeMember: server.removeMember,
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
export const teamApi: TeamRepository = isDemoMode
  ? demoTeamRepository
  : isNativeClient
    ? httpTeamRepository
    : serverRepository;
