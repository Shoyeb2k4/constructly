import { DEMO_USER } from "@/lib/auth/demo";
import { inviteSchema } from "../schema";
import type { TeamRepository } from "../repository";
import type { InviteInput, MemberStatus, TeamInvitation, TeamMember } from "../types";
import type { Role } from "@/lib/auth/types";

/**
 * Demo team members and invitations, in localStorage.
 *
 * Users had no demo layer either, so the screen was empty in demo mode and the
 * invite / disable / role-change flows had never been exercised outside a real
 * database. The safety rules that matter are mirrored here rather than skipped,
 * because a demo that lets you lock yourself out teaches the wrong lesson:
 *
 *   • The last active Owner can never be demoted, disabled or removed.
 *   • You cannot disable or remove yourself.
 *   • An email already in the company cannot be re-invited.
 */

const K = {
  members: "constructly.demo.teamMembers.v1",
  invitations: "constructly.demo.teamInvitations.v1",
};

const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

function seedMembers(): TeamMember[] {
  return [
    {
      id: DEMO_USER.id,
      email: DEMO_USER.email,
      fullName: DEMO_USER.fullName,
      role: "OWNER",
      roleId: "role-owner",
      roleName: "Owner",
      status: "ACTIVE",
      isSelf: true,
      createdAt: iso(-420),
    },
    {
      id: "20000000-0000-0000-0000-000000000002",
      email: "priya.nair@demo.constructly.app",
      fullName: "Priya Nair",
      role: "PROJECT_MANAGER",
      roleId: "role-project_manager",
      roleName: "Project Manager",
      status: "ACTIVE",
      isSelf: false,
      createdAt: iso(-260),
    },
    {
      id: "20000000-0000-0000-0000-000000000003",
      email: "rahul.desai@demo.constructly.app",
      fullName: "Rahul Desai",
      role: "PROJECT_MANAGER",
      roleId: "role-accountant",
      roleName: "Accountant",
      status: "ACTIVE",
      isSelf: false,
      createdAt: iso(-180),
    },
    {
      id: "20000000-0000-0000-0000-000000000004",
      email: "imran.shaikh@demo.constructly.app",
      fullName: "Imran Shaikh",
      role: "PROJECT_MANAGER",
      roleId: "role-supervisor",
      roleName: "Supervisor",
      status: "ACTIVE",
      isSelf: false,
      createdAt: iso(-95),
    },
    {
      // A deactivated member, so the disabled state has a worked example.
      id: "20000000-0000-0000-0000-000000000005",
      email: "former.staff@demo.constructly.app",
      fullName: "Anjali Rao",
      role: "PROJECT_MANAGER",
      roleId: "role-site_engineer",
      roleName: "Site Engineer",
      status: "DISABLED",
      isSelf: false,
      createdAt: iso(-300),
    },
  ];
}

function seedInvitations(): TeamInvitation[] {
  return [
    {
      id: "inv-1",
      email: "new.engineer@demo.constructly.app",
      role: "PROJECT_MANAGER",
      invitedByName: DEMO_USER.fullName,
      createdAt: iso(-2),
      expiresAt: iso(5),
      expired: false,
    },
    {
      // An expired invite, so that state is visible without waiting a week.
      id: "inv-2",
      email: "lapsed.invite@demo.constructly.app",
      role: "PROJECT_MANAGER",
      invitedByName: DEMO_USER.fullName,
      createdAt: iso(-20),
      expiresAt: iso(-13),
      expired: true,
    },
  ];
}

function read<T>(key: string, seed: () => T[]): T[] {
  if (typeof window === "undefined") return seed();
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T[];
  } catch {
    /* corrupt entry — reseed */
  }
  const fresh = seed();
  write(key, fresh);
  return fresh;
}

function write<T>(key: string, rows: T[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(rows));
  } catch {
    /* quota */
  }
}

const loadMembers = () => read(K.members, seedMembers);
const loadInvites = () => read(K.invitations, seedInvitations);

/** The last active Owner is the one account that can never be locked out. */
function assertNotLastOwner(members: TeamMember[], userId: string): void {
  const target = members.find((m) => m.id === userId);
  if (!target || target.role !== "OWNER") return;
  const activeOwners = members.filter((m) => m.role === "OWNER" && m.status === "ACTIVE");
  if (activeOwners.length <= 1) {
    throw new Error("This is the last active owner. Promote someone else first.");
  }
}

function member(members: TeamMember[], userId: string): TeamMember {
  const m = members.find((x) => x.id === userId);
  if (!m) throw new Error("NOT_FOUND");
  return m;
}

export const demoTeamRepository: TeamRepository = {
  async listMembers() {
    return loadMembers()
      .slice()
      .sort((a, b) => Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE") || a.fullName.localeCompare(b.fullName));
  },

  async listInvitations() {
    const now = Date.now();
    return loadInvites().map((i) => ({ ...i, expired: Date.parse(i.expiresAt) < now }));
  },

  async inviteMember(input: InviteInput) {
    const { email, role } = inviteSchema.parse(input);
    const members = loadMembers();
    if (members.some((m) => m.email.toLowerCase() === email.toLowerCase())) {
      throw new Error("That email already belongs to someone in this company.");
    }
    const invites = loadInvites();
    if (invites.some((i) => i.email.toLowerCase() === email.toLowerCase() && !i.expired)) {
      throw new Error("There is already a pending invitation for that email.");
    }
    invites.push({
      id: `inv-${Math.random().toString(36).slice(2, 9)}`,
      email,
      role,
      invitedByName: DEMO_USER.fullName,
      createdAt: iso(0),
      expiresAt: iso(7),
      expired: false,
    });
    write(K.invitations, invites);
  },

  async resendInvitation(id: string) {
    const invites = loadInvites();
    const inv = invites.find((i) => i.id === id);
    if (!inv) throw new Error("NOT_FOUND");
    inv.createdAt = iso(0);
    inv.expiresAt = iso(7);
    inv.expired = false;
    write(K.invitations, invites);
  },

  async cancelInvitation(id: string) {
    write(
      K.invitations,
      loadInvites().filter((i) => i.id !== id),
    );
  },

  async changeMemberRole(userId: string, role: Role) {
    const members = loadMembers();
    const target = member(members, userId);
    // Demoting the last owner would leave the company with no full-access
    // account — the one change that cannot be undone from inside the app.
    if (target.role === "OWNER" && role !== "OWNER") assertNotLastOwner(members, userId);
    target.role = role;
    write(K.members, members);
  },

  async setMemberStatus(userId: string, status: MemberStatus) {
    const members = loadMembers();
    const target = member(members, userId);
    if (target.isSelf && status === "DISABLED") {
      throw new Error("You can't disable your own access.");
    }
    if (status === "DISABLED") assertNotLastOwner(members, userId);
    target.status = status;
    write(K.members, members);
  },

  async removeMember(userId: string) {
    const members = loadMembers();
    const target = member(members, userId);
    if (target.isSelf) throw new Error("You can't remove yourself.");
    assertNotLastOwner(members, userId);
    write(
      K.members,
      members.filter((m) => m.id !== userId),
    );
  },
};

/** Reset helper for tests and for a demo user who wants a clean slate. */
export function resetDemoTeam(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(K.members);
  window.localStorage.removeItem(K.invitations);
}
