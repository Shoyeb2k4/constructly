"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
// Through the repository, never the server actions directly: in demo mode
// those hit Prisma and Roles renders as an empty screen.
import { rolesApi } from "./data";
import type { RoleDTO } from "./server/roles-actions";

export const rbacKeys = {
  roles: ["rbac", "roles"] as const,
  assignableRoles: ["rbac", "assignable-roles"] as const,
};

function errMsg(e: unknown): string {
  return e instanceof Error && e.message && !/^(FORBIDDEN|NOT_FOUND|PROTECTED_ROLE)$/.test(e.message)
    ? e.message
    : e instanceof Error && e.message === "PROTECTED_ROLE"
      ? "That role is protected and can't be changed."
      : e instanceof Error && e.message === "FORBIDDEN"
        ? "You don't have permission to do that."
        : "Something went wrong. Please try again.";
}

export function useRoles() {
  return useQuery({ queryKey: rbacKeys.roles, queryFn: () => rolesApi.listRoles() });
}

export function useAssignableRoles(enabled = true) {
  return useQuery({ queryKey: rbacKeys.assignableRoles, queryFn: () => rolesApi.listAssignableRoles(), enabled });
}

function useRoleInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: rbacKeys.roles });
    // A member's assigned role may have changed → refresh the members list too.
    qc.invalidateQueries({ queryKey: ["team", "members"] });
  };
}

export function useCreateRole() {
  const invalidate = useRoleInvalidate();
  return useMutation({
    mutationFn: (input: { name: string; description?: string | null; permissions: string[] }) =>
      rolesApi.createRole(input),
    onSuccess: (r: RoleDTO) => {
      invalidate();
      toast.success("Role created", { description: r.name });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useUpdateRole() {
  const invalidate = useRoleInvalidate();
  return useMutation({
    mutationFn: (v: { id: string; patch: { name?: string; description?: string | null; permissions?: string[] } }) =>
      rolesApi.updateRole(v.id, v.patch),
    onSuccess: () => {
      invalidate();
      toast.success("Role saved");
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useDuplicateRole() {
  const invalidate = useRoleInvalidate();
  return useMutation({
    mutationFn: (id: string) => rolesApi.duplicateRole(id),
    onSuccess: (r) => {
      invalidate();
      toast.success("Role duplicated", { description: r.name });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useDeleteRole() {
  const invalidate = useRoleInvalidate();
  return useMutation({
    mutationFn: (id: string) => rolesApi.deleteRole(id),
    onSuccess: () => {
      invalidate();
      toast.success("Role deleted");
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useAssignUserRole() {
  const invalidate = useRoleInvalidate();
  return useMutation({
    mutationFn: (v: { userId: string; roleId: string }) => rolesApi.assignUserRole(v.userId, v.roleId),
    onSuccess: () => {
      invalidate();
      toast.success("Role updated");
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}
