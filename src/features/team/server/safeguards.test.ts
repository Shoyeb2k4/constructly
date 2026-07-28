import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";

const OWNER: SessionUser = { id: "o1", email: "o@x.com", fullName: "Owner", role: "OWNER", company: { id: "c1", name: "Co" } };

vi.mock("@/lib/auth/current-user", () => ({ requireUser: async () => OWNER }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ adminInviteUser: async () => ({ userId: "x" }), adminDeleteUser: async () => {} }));

const prismaMock = vi.hoisted(() => ({
  user: { findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn(), update: vi.fn(), delete: vi.fn() },
  invitation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  activityLog: { create: vi.fn() },
  project: { updateMany: vi.fn() },
  purchaseOrder: { updateMany: vi.fn() },
  vendorPayment: { updateMany: vi.fn() },
  goodsReceipt: { updateMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMock }));

import * as actions from "./actions";

beforeEach(() => {
  Object.values(prismaMock).forEach((m) => {
    if (typeof m === "object") Object.values(m).forEach((fn) => (fn as { mockReset?: () => void }).mockReset?.());
  });
  prismaMock.$transaction.mockClear();
  prismaMock.$transaction.mockImplementation(async (ops: unknown) =>
    Array.isArray(ops) ? Promise.all(ops) : (ops as (t: unknown) => unknown)(prismaMock),
  );
});

describe("last-owner safeguards", () => {
  it("changeMemberRole can't demote the last active owner", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: "o2", role: "OWNER", email: "o2@x.com" });
    prismaMock.user.count.mockResolvedValue(1);
    await expect(actions.changeMemberRole("o2", "PROJECT_MANAGER")).rejects.toThrow(/last owner/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("changeMemberRole allows demotion when another owner remains", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: "o2", role: "OWNER", email: "o2@x.com" });
    prismaMock.user.count.mockResolvedValue(2);
    await actions.changeMemberRole("o2", "PROJECT_MANAGER");
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: "PROJECT_MANAGER" } }),
    );
  });

  it("setMemberStatus can't deactivate the last owner", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: "o2", role: "OWNER", email: "o2@x.com" });
    prismaMock.user.count.mockResolvedValue(1);
    await expect(actions.setMemberStatus("o2", "DISABLED")).rejects.toThrow(/last owner/i);
  });

  it("removeMember can't remove the last owner", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: "o2", role: "OWNER", email: "o2@x.com" });
    prismaMock.user.count.mockResolvedValue(1);
    await expect(actions.removeMember("o2")).rejects.toThrow(/last owner/i);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe("self-action guards", () => {
  it("can't deactivate yourself", async () => {
    await expect(actions.setMemberStatus("o1", "DISABLED")).rejects.toThrow(/your own/i);
  });
  it("can't remove yourself", async () => {
    await expect(actions.removeMember("o1")).rejects.toThrow(/yourself/i);
  });
});

describe("tenant isolation", () => {
  it("changeMemberRole on a user outside the company is NOT_FOUND", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null); // scoped by companyId ⇒ no match
    await expect(actions.changeMemberRole("other-co-user", "OWNER")).rejects.toThrow("NOT_FOUND");
    // the query is company-scoped
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: "c1" }) }),
    );
  });

  it("removeMember on a foreign user is NOT_FOUND and touches nothing", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    await expect(actions.removeMember("foreign")).rejects.toThrow("NOT_FOUND");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe("invite guards", () => {
  it("rejects inviting an existing member", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: "m", email: "a@b.com" });
    await expect(actions.inviteMember({ email: "a@b.com", role: "PROJECT_MANAGER" })).rejects.toThrow(
      /already on your team/i,
    );
  });

  it("rejects a duplicate pending invite", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.invitation.findFirst.mockResolvedValue({ id: "i", email: "a@b.com" });
    await expect(actions.inviteMember({ email: "a@b.com", role: "PROJECT_MANAGER" })).rejects.toThrow(
      /pending invite/i,
    );
  });
});
