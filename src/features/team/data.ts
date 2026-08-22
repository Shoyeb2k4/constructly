import { isDemoMode } from "@/lib/env";
import { demoTeamRepository } from "./demo/demo-repository";
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

export const teamApi: TeamRepository = isDemoMode ? demoTeamRepository : serverRepository;
