import type { Role } from "@/lib/auth/types";

export type MemberStatus = "ACTIVE" | "DISABLED";

/** An active or deactivated company member. */
export interface TeamMember {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  /** Assigned RBAC company role (null only for legacy rows without one). */
  roleId: string | null;
  roleName: string | null;
  status: MemberStatus;
  /** True for the signed-in owner viewing the list (self-actions are guarded). */
  isSelf: boolean;
  createdAt: string;
}

/** A pending email invitation. */
export interface TeamInvitation {
  id: string;
  email: string;
  role: Role;
  invitedByName: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
}

export interface InviteInput {
  email: string;
  role: Role;
}

/** Shown on the accept-invite page before the invitee creates their account. */
export interface PendingInviteInfo {
  companyName: string;
  role: Role;
  email: string;
}
