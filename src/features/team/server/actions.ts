"use server";

import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma";
import { requirePermission } from "@/lib/auth/permissions";
import type { Role, SessionUser } from "@/lib/auth/types";
import { createServerClient } from "@/lib/supabase/server";
import { adminInviteUser, adminDeleteUser } from "@/lib/supabase/admin";
import { assertCanAssignRole } from "../authz";
import { inviteSchema, acceptSchema, roleSchema, ROLE_LABEL } from "../schema";
import type {
  InviteInput,
  MemberStatus,
  PendingInviteInfo,
  TeamInvitation,
  TeamMember,
} from "../types";

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

async function activeOwnerCount(companyId: string): Promise<number> {
  return prisma.user.count({ where: { companyId, role: "OWNER", status: "ACTIVE" } });
}

async function logTeam(
  user: SessionUser,
  action: string,
  entityId: string,
  summary: string,
  meta?: Prisma.InputJsonValue,
) {
  await prisma.activityLog.create({
    data: {
      companyId: user.company.id,
      actorId: user.id,
      action,
      entityType: "user",
      entityId,
      summary,
      meta: meta ?? undefined,
    },
  });
}

// ── Reads ─────────────────────────────────────────────────────────────
export async function listMembers(): Promise<TeamMember[]> {
  const user = await requirePermission("users.view");
  const rows = await prisma.user.findMany({
    where: { companyId: user.company.id },
    orderBy: [{ role: "asc" }, { fullName: "asc" }],
  });
  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role as Role,
    status: u.status === "DISABLED" ? "DISABLED" : "ACTIVE",
    isSelf: u.id === user.id,
    createdAt: u.createdAt.toISOString(),
  }));
}

export async function listInvitations(): Promise<TeamInvitation[]> {
  const user = await requirePermission("users.view");
  const rows = await prisma.invitation.findMany({
    where: { companyId: user.company.id, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: { invitedBy: { select: { fullName: true } } },
  });
  const now = Date.now();
  return rows.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role as Role,
    invitedByName: i.invitedBy.fullName,
    createdAt: i.createdAt.toISOString(),
    expiresAt: i.expiresAt.toISOString(),
    expired: i.expiresAt.getTime() < now,
  }));
}

// ── Invitations ───────────────────────────────────────────────────────
export async function inviteMember(input: InviteInput): Promise<void> {
  const user = await requirePermission("users.invite");
  const { email, role } = inviteSchema.parse(input);
  // No privilege escalation: you can't invite someone into a role whose
  // permissions you don't hold yourself.
  assertCanAssignRole(user, role);

  const alreadyMember = await prisma.user.findFirst({
    where: { companyId: user.company.id, email },
  });
  if (alreadyMember) throw new Error("That email is already on your team.");

  const pending = await prisma.invitation.findFirst({
    where: { companyId: user.company.id, email, status: "PENDING" },
  });
  if (pending) throw new Error("There's already a pending invite for that email — resend or cancel it.");

  let authUserId: string | null = null;
  try {
    const res = await adminInviteUser(email, {
      invited_company_id: user.company.id,
      invited_role: role,
    });
    authUserId = res.userId;
  } catch (e) {
    const msg = e instanceof Error ? e.message.toLowerCase() : "";
    if (/already|registered|exists/.test(msg)) {
      throw new Error("That email already has an account and can't be invited.");
    }
    throw new Error("Couldn't send the invitation email. Please try again.");
  }

  try {
    await prisma.invitation.create({
      data: {
        companyId: user.company.id,
        email,
        role,
        invitedById: user.id,
        authUserId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
  } catch (e) {
    // Partial unique index (company_id, email) WHERE status='PENDING' — a
    // concurrent invite lost the race.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new Error("There's already a pending invite for that email — resend or cancel it.");
    }
    throw e;
  }
  await logTeam(user, "team.invited", user.company.id, `Invited ${email} as ${ROLE_LABEL[role]}`, {
    email,
    role,
  });
}

export async function resendInvitation(id: string): Promise<void> {
  const user = await requirePermission("users.invite");
  const inv = await prisma.invitation.findFirst({
    where: { id, companyId: user.company.id, status: "PENDING" },
  });
  if (!inv) throw new Error("NOT_FOUND");
  // Best-effort re-send; some Supabase configs won't resend to an existing
  // unconfirmed user, so failure here isn't fatal — the original link is valid.
  await adminInviteUser(inv.email, {
    invited_company_id: user.company.id,
    invited_role: inv.role,
  }).catch(() => {});
  await prisma.invitation.update({
    where: { id },
    data: { expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
  });
  await logTeam(user, "team.invite_resent", user.company.id, `Resent invite to ${inv.email}`);
}

export async function cancelInvitation(id: string): Promise<void> {
  const user = await requirePermission("users.invite");
  const inv = await prisma.invitation.findFirst({ where: { id, companyId: user.company.id } });
  if (!inv) throw new Error("NOT_FOUND");
  if (inv.status === "PENDING" && inv.authUserId) {
    await adminDeleteUser(inv.authUserId).catch(() => {});
  }
  await prisma.invitation.update({ where: { id }, data: { status: "REVOKED" } });
  await logTeam(user, "team.invite_cancelled", user.company.id, `Cancelled invite to ${inv.email}`);
}

// ── Member management ─────────────────────────────────────────────────
export async function changeMemberRole(userId: string, roleRaw: Role): Promise<void> {
  const user = await requirePermission("roles.assign");
  const role = roleSchema.parse(roleRaw);
  // No privilege escalation: only assign a role whose permissions you hold.
  assertCanAssignRole(user, role);
  const target = await prisma.user.findFirst({ where: { id: userId, companyId: user.company.id } });
  if (!target) throw new Error("NOT_FOUND");
  if (target.role === role) return;
  if (target.role === "OWNER" && role !== "OWNER" && (await activeOwnerCount(user.company.id)) <= 1) {
    throw new Error("You can't remove the last owner. Assign another owner first.");
  }
  await prisma.user.update({ where: { id: userId }, data: { role } });
  await logTeam(user, "team.role_changed", userId, `Changed ${target.email} to ${ROLE_LABEL[role]}`, {
    from: target.role,
    to: role,
  });
}

export async function setMemberStatus(userId: string, status: MemberStatus): Promise<void> {
  const user = await requirePermission("users.disable");
  if (userId === user.id) throw new Error("You can't change your own status.");
  const target = await prisma.user.findFirst({ where: { id: userId, companyId: user.company.id } });
  if (!target) throw new Error("NOT_FOUND");
  if (status === "DISABLED" && target.role === "OWNER" && (await activeOwnerCount(user.company.id)) <= 1) {
    throw new Error("You can't deactivate the last owner.");
  }
  await prisma.user.update({ where: { id: userId }, data: { status } });
  await logTeam(
    user,
    status === "DISABLED" ? "team.deactivated" : "team.reactivated",
    userId,
    `${status === "DISABLED" ? "Deactivated" : "Reactivated"} ${target.email}`,
  );
}

export async function removeMember(userId: string): Promise<void> {
  const user = await requirePermission("users.delete");
  if (userId === user.id) throw new Error("You can't remove yourself.");
  const target = await prisma.user.findFirst({ where: { id: userId, companyId: user.company.id } });
  if (!target) throw new Error("NOT_FOUND");
  if (target.role === "OWNER" && (await activeOwnerCount(user.company.id)) <= 1) {
    throw new Error("You can't remove the last owner.");
  }

  // Reassign the member's authored records to the acting owner so history is
  // preserved and the RESTRICT foreign keys don't block deletion. pmId,
  // favorites and activity handle themselves (SetNull / Cascade).
  const toOwner = { data: { createdById: user.id } };
  await prisma.$transaction([
    prisma.activityLog.create({
      data: {
        companyId: user.company.id,
        actorId: user.id,
        action: "team.removed",
        entityType: "user",
        entityId: userId,
        summary: `Removed ${target.email}`,
        meta: { email: target.email, role: target.role },
      },
    }),
    prisma.project.updateMany({ where: { createdById: userId }, ...toOwner }),
    prisma.purchaseOrder.updateMany({ where: { createdById: userId }, ...toOwner }),
    prisma.purchaseOrder.updateMany({ where: { approvedById: userId }, data: { approvedById: user.id } }),
    prisma.vendorPayment.updateMany({ where: { createdById: userId }, ...toOwner }),
    prisma.goodsReceipt.updateMany({ where: { createdById: userId }, ...toOwner }),
    prisma.invitation.updateMany({ where: { invitedById: userId }, data: { invitedById: user.id } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);
  // Remove the auth user too (best-effort; access is already gone).
  await adminDeleteUser(userId).catch(() => {});
}

// ── Accept flow (invitee has no user row yet — reads the session directly) ──
async function sessionEmail(): Promise<{ id: string; email: string } | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;
  return { id: user.id, email: user.email.toLowerCase() };
}

export async function getPendingInviteForMe(): Promise<PendingInviteInfo | null> {
  const me = await sessionEmail();
  if (!me) return null;
  const inv = await prisma.invitation.findFirst({
    where: { email: me.email, status: "PENDING", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    include: { company: { select: { name: true } } },
  });
  if (!inv) return null;
  return { companyName: inv.company.name, role: inv.role as Role, email: inv.email };
}

export async function acceptInvitation(input: { fullName: string }): Promise<void> {
  const me = await sessionEmail();
  if (!me) throw new Error("UNAUTHENTICATED");
  const { fullName } = acceptSchema.parse(input);

  if (await prisma.user.findUnique({ where: { id: me.id } })) return; // already a member

  const inv = await prisma.invitation.findFirst({
    where: { email: me.email, status: "PENDING", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!inv) throw new Error("No pending invitation for your email.");

  await prisma.$transaction([
    prisma.user.create({
      data: {
        id: me.id,
        companyId: inv.companyId,
        email: me.email,
        fullName,
        role: inv.role,
        status: "ACTIVE",
      },
    }),
    prisma.invitation.update({
      where: { id: inv.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    }),
    prisma.activityLog.create({
      data: {
        companyId: inv.companyId,
        actorId: me.id,
        action: "team.joined",
        entityType: "user",
        entityId: me.id,
        summary: `${fullName} joined the team`,
      },
    }),
  ]);
}
