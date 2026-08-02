import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS, type Permission } from "@/features/rbac/permissions";

const h = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/current-user", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("UNAUTHENTICATED");
    return h.user;
  },
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: { company: { update: vi.fn(), findUniqueOrThrow: vi.fn() }, activityLog: { create: vi.fn() } },
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { updateCompanyProfile, updateBrandColors, setBrandingAsset } from "./actions";

function u(permissions: Permission[]): SessionUser {
  return { id: "u1", email: "u@x.com", fullName: "U", role: "PROJECT_MANAGER", permissions, company: { id: "c1", name: "Co" } };
}

beforeEach(() => {
  h.user = null;
});

describe("company profile editing — company.edit", () => {
  it("a viewer (company.view only) cannot edit the company profile", async () => {
    h.user = u(["company.view"]);
    await expect(updateCompanyProfile({ name: "X" })).rejects.toThrow("FORBIDDEN");
  });
});

describe("branding is separate from general edit — company.branding", () => {
  it("company.edit does NOT grant brand-colour editing", async () => {
    h.user = u(["company.view", "company.edit"]);
    await expect(updateBrandColors({ primary: "#123456" } as never)).rejects.toThrow("FORBIDDEN");
  });

  it("a company logo asset requires company.branding (edit is not enough)", async () => {
    h.user = u(["company.view", "company.edit"]);
    await expect(setBrandingAsset("logo", "c1/logo.png")).rejects.toThrow("FORBIDDEN");
  });
});

describe("sensitive company areas are distinct permissions", () => {
  it("billing / subscription / api_keys / integrations / security each exist separately", () => {
    for (const p of [
      "company.billing",
      "company.subscription",
      "company.api_keys",
      "company.integrations",
      "company.security",
    ] as Permission[]) {
      expect(ALL_PERMISSIONS).toContain(p);
      // and they are NOT the same as general edit
      expect(p).not.toBe("company.edit");
    }
  });
});
