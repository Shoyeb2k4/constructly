import type { InviteInput, MemberStatus, TeamInvitation, TeamMember } from "./types";
import type { Role } from "@/lib/auth/types";

/**
 * Company membership contract — who has access, and the invitations pending.
 *
 * Split out for the same reason branding and roles were: the hooks called the
 * Prisma-backed server actions directly, so Users was an empty screen in demo
 * mode and the invite / disable / role-change flows had never been exercised
 * outside a real database.
 */
export interface TeamRepository {
  listMembers(): Promise<TeamMember[]>;
  listInvitations(): Promise<TeamInvitation[]>;
  inviteMember(input: InviteInput): Promise<void>;
  resendInvitation(id: string): Promise<void>;
  cancelInvitation(id: string): Promise<void>;
  changeMemberRole(userId: string, role: Role): Promise<void>;
  setMemberStatus(userId: string, status: MemberStatus): Promise<void>;
  removeMember(userId: string): Promise<void>;
}
