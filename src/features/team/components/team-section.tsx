"use client";

import * as React from "react";
import { toast } from "sonner";
import { MailPlus, RotateCw, X, MoreVertical, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RowsSkeleton } from "@/components/patterns/loading-state";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/auth/types";
import { ASSIGNABLE_ROLES, ROLE_LABEL } from "../schema";
import {
  useMembers,
  useInvitations,
  useInviteMember,
  useResendInvitation,
  useCancelInvitation,
  useSetMemberStatus,
  useRemoveMember,
} from "../hooks";
import type { TeamMember } from "../types";
import { useCan } from "@/features/rbac/permission-context";
import { useAssignableRoles, useAssignUserRole } from "@/features/rbac/hooks";

export function TeamSection() {
  const can = useCan();
  const canInvite = can("users.invite");
  const canAssignRoles = can("roles.assign");
  const canDisable = can("users.disable");
  const canDelete = can("users.delete");
  const { data: assignableRoles = [] } = useAssignableRoles(canAssignRoles);
  const assignRole = useAssignUserRole();
  const { data: members = [], isLoading } = useMembers();
  const { data: invitations = [] } = useInvitations();
  const invite = useInviteMember();
  const resend = useResendInvitation();
  const cancel = useCancelInvitation();
  const setStatus = useSetMemberStatus();
  const removeMut = useRemoveMember();

  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<Role>("PROJECT_MANAGER");
  const [confirmRemove, setConfirmRemove] = React.useState<TeamMember | null>(null);

  const activeOwners = members.filter((m) => m.role === "OWNER" && m.status === "ACTIVE").length;

  function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    invite.mutate({ email: email.trim(), role }, { onSuccess: () => setEmail("") });
  }

  return (
    <div className="space-y-6">
      {/* Invite */}
      {canInvite && (
      <Card>
        <CardHeader>
          <CardTitle>Invite a member</CardTitle>
          <CardDescription>They&apos;ll get an email to set a password and join.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={sendInvite} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="inv-email">Email</Label>
              <Input
                id="inv-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger id="inv-role" className="w-full sm:w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" variant="primary" disabled={invite.isPending || !email.trim()}>
              <MailPlus className="size-4" />
              Invite
            </Button>
          </form>
        </CardContent>
      </Card>
      )}

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
            <CardDescription>Invites that haven&apos;t been accepted yet.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border py-0">
            {invitations.map((inv) => (
              <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{inv.email}</p>
                  <p className="text-xs text-foreground-subtle">
                    {ROLE_LABEL[inv.role]} · invited by {inv.invitedByName}
                    {inv.expired ? " · expired" : ""}
                  </p>
                </div>
                {canInvite && (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => resend.mutate(inv.id)} disabled={resend.isPending}>
                      <RotateCw className="size-3.5" />
                      Resend
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger-foreground"
                      onClick={() => cancel.mutate(inv.id)}
                      disabled={cancel.isPending}
                    >
                      <X className="size-3.5" />
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Members */}
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>People with access to this workspace.</CardDescription>
        </CardHeader>
        <CardContent className="py-0">
          {isLoading ? (
            <div className="py-4"><RowsSkeleton rows={3} /></div>
          ) : (
            <div className="divide-y divide-border">
              {members.map((m) => {
                const isLastOwner = m.role === "OWNER" && activeOwners <= 1;
                const disabled = m.status === "DISABLED";
                return (
                  <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn("truncate text-sm font-medium", disabled && "text-foreground-muted")}>
                          {m.fullName}
                        </span>
                        {m.isSelf && <Badge variant="neutral">You</Badge>}
                        {disabled && <Badge variant="neutral">Deactivated</Badge>}
                      </div>
                      <p className="truncate text-xs text-foreground-subtle">{m.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {canAssignRoles ? (
                        <Select
                          value={m.roleId ?? ""}
                          onValueChange={(v) => assignRole.mutate({ userId: m.id, roleId: v })}
                          disabled={m.isSelf || isLastOwner || assignRole.isPending}
                        >
                          <SelectTrigger className="h-8 w-44 text-xs" aria-label={`Role for ${m.fullName}`}>
                            <SelectValue placeholder="No role" />
                          </SelectTrigger>
                          <SelectContent>
                            {assignableRoles.map((r) => (
                              <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs text-foreground-muted">{m.roleName ?? "—"}</span>
                      )}
                      {m.isSelf || (!canDisable && !canDelete) ? (
                        <div className="size-8" aria-hidden />
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`Actions for ${m.fullName}`}>
                              <MoreVertical className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {canDisable &&
                              (disabled ? (
                                <DropdownMenuItem onSelect={() => setStatus.mutate({ userId: m.id, status: "ACTIVE" })}>
                                  Reactivate
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  disabled={isLastOwner}
                                  onSelect={() => setStatus.mutate({ userId: m.id, status: "DISABLED" })}
                                >
                                  Deactivate
                                </DropdownMenuItem>
                              ))}
                            {canDelete && (
                              <DropdownMenuItem
                                disabled={isLastOwner}
                                onSelect={(e) => {
                                  e.preventDefault();
                                  if (isLastOwner) {
                                    toast.error("You can't remove the last owner.");
                                    return;
                                  }
                                  setConfirmRemove(m);
                                }}
                                className="text-danger-foreground"
                              >
                                Remove
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!confirmRemove} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {confirmRemove?.fullName}?</DialogTitle>
            <DialogDescription>
              They&apos;ll lose access immediately. Records they created stay in the workspace, reassigned
              to you. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmRemove(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={removeMut.isPending}
              onClick={() => {
                const id = confirmRemove!.id;
                setConfirmRemove(null);
                removeMut.mutate(id);
              }}
            >
              {removeMut.isPending ? <Loader2 className="size-4 animate-spin" /> : "Remove member"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
