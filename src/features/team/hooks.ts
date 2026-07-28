"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listMembers,
  listInvitations,
  inviteMember,
  resendInvitation,
  cancelInvitation,
  changeMemberRole,
  setMemberStatus,
  removeMember,
} from "./server/actions";
import type { InviteInput, MemberStatus } from "./types";
import type { Role } from "@/lib/auth/types";

export const teamKeys = {
  members: ["team", "members"] as const,
  invitations: ["team", "invitations"] as const,
};

export function useMembers() {
  return useQuery({ queryKey: teamKeys.members, queryFn: () => listMembers() });
}
export function useInvitations() {
  return useQuery({ queryKey: teamKeys.invitations, queryFn: () => listInvitations() });
}

function errMsg(e: unknown): string {
  return e instanceof Error && e.message && e.message !== "FORBIDDEN"
    ? e.message
    : "Something went wrong. Please try again.";
}

/** Invalidate both team lists after any mutation. */
function useTeamInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: teamKeys.members });
    qc.invalidateQueries({ queryKey: teamKeys.invitations });
  };
}

export function useInviteMember() {
  const invalidate = useTeamInvalidate();
  return useMutation({
    mutationFn: (input: InviteInput) => inviteMember(input),
    onSuccess: () => {
      invalidate();
      toast.success("Invitation sent");
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useResendInvitation() {
  const invalidate = useTeamInvalidate();
  return useMutation({
    mutationFn: (id: string) => resendInvitation(id),
    onSuccess: () => {
      invalidate();
      toast.success("Invitation resent");
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useCancelInvitation() {
  const invalidate = useTeamInvalidate();
  return useMutation({
    mutationFn: (id: string) => cancelInvitation(id),
    onSuccess: () => {
      invalidate();
      toast.success("Invitation cancelled");
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useChangeMemberRole() {
  const invalidate = useTeamInvalidate();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) => changeMemberRole(userId, role),
    onSuccess: () => {
      invalidate();
      toast.success("Role updated");
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useSetMemberStatus() {
  const invalidate = useTeamInvalidate();
  return useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: MemberStatus }) =>
      setMemberStatus(userId, status),
    onSuccess: (_r, v) => {
      invalidate();
      toast.success(v.status === "DISABLED" ? "Member deactivated" : "Member reactivated");
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useRemoveMember() {
  const invalidate = useTeamInvalidate();
  return useMutation({
    mutationFn: (userId: string) => removeMember(userId),
    onSuccess: () => {
      invalidate();
      toast.success("Member removed");
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}
