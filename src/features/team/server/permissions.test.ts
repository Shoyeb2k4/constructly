import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS } from "@/features/rbac/permissions";

/**
 * Team-management authorization. Each action requires its users/roles
 * permission and the guard runs before any DB / admin-API access, so mocking the
 * auth layer alone proves a PROJECT_MANAGER (holding none of them) is refused
 * even if UI gating is bypassed.
 */

const OWNER: SessionUser = { id: "o1", email: "o@x.com", fullName: "Owner", role: "OWNER", permissions: [...ALL_PERMISSIONS], company: { id: "c1", name: "Co" } };
const PM: SessionUser = { id: "p1", email: "p@x.com", fullName: "PM", role: "PROJECT_MANAGER", permissions: [], company: { id: "c1", name: "Co" } };

let currentUser: SessionUser = OWNER;
vi.mock("@/lib/auth/current-user", () => ({ requireUser: async () => currentUser }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: new Proxy({}, { get() { throw new Error("DB_TOUCHED"); } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  adminInviteUser: async () => ({ userId: "x" }),
  adminDeleteUser: async () => {},
}));

import * as actions from "./actions";

beforeEach(() => { currentUser = OWNER; });

const ownerOnly: { name: string; run: () => Promise<unknown> }[] = [
  { name: "listMembers", run: () => actions.listMembers() },
  { name: "listInvitations", run: () => actions.listInvitations() },
  { name: "inviteMember", run: () => actions.inviteMember({ email: "a@b.com", role: "PROJECT_MANAGER" }) },
  { name: "resendInvitation", run: () => actions.resendInvitation("i1") },
  { name: "cancelInvitation", run: () => actions.cancelInvitation("i1") },
  { name: "changeMemberRole", run: () => actions.changeMemberRole("u1", "OWNER") },
  { name: "setMemberStatus", run: () => actions.setMemberStatus("u1", "DISABLED") },
  { name: "removeMember", run: () => actions.removeMember("u1") },
];

describe("team authorization — owner-only", () => {
  for (const a of ownerOnly) {
    it(`${a.name} rejects a PROJECT_MANAGER with FORBIDDEN`, async () => {
      currentUser = PM;
      await expect(a.run()).rejects.toThrow("FORBIDDEN");
    });
  }

  it("owner passes the role guard (reaches the mocked DB)", async () => {
    currentUser = OWNER;
    await expect(actions.listMembers()).rejects.toThrow("DB_TOUCHED");
  });
});
