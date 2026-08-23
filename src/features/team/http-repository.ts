import { rpcMethod } from "@/lib/mobile/rpc";
import type { TeamRepository } from "./repository";

/**
 * Team membership and invitations over the mobile RPC transport — the third
 * implementation of `TeamRepository`, beside `demo/` and the
 * Server-Action-backed one in `data.ts`.
 *
 * Pure transport. Every method forwards to the identically named entry in the
 * mobile RPC allowlist, which invokes the very same server function the web app
 * calls, under the caller's real resolved session. No query logic, no
 * authorization, no formatting — anything resembling business logic here would
 * be a second source of truth, which is exactly what this architecture exists
 * to avoid.
 *
 * Annotated as `TeamRepository`, so the compiler checks every key and
 * signature against the interface the UI already consumes. Method names match
 * the interface rather than being shortened, so repository, registry and call
 * site share one vocabulary.
 */
export const httpTeamRepository: TeamRepository = {
  listMembers: rpcMethod("team", "listMembers"),
  listInvitations: rpcMethod("team", "listInvitations"),
  inviteMember: rpcMethod("team", "inviteMember"),
  resendInvitation: rpcMethod("team", "resendInvitation"),
  cancelInvitation: rpcMethod("team", "cancelInvitation"),
  changeMemberRole: rpcMethod("team", "changeMemberRole"),
  setMemberStatus: rpcMethod("team", "setMemberStatus"),
  removeMember: rpcMethod("team", "removeMember"),
};
