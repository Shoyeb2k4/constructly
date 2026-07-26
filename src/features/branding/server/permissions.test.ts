import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";

/**
 * Branding authorization. Company-level branding mutations are owner-only and
 * the guard runs before any DB/storage access (mocking the auth layer alone
 * proves it). Per-user assets (signature, profile photo) are NOT owner-gated —
 * any member manages their own, and RLS ("{companyId}/{userId}/…") stops them
 * touching anyone else's.
 */

const OWNER: SessionUser = { id: "o1", email: "o@x.com", fullName: "Owner", role: "OWNER", company: { id: "c1", name: "Co" } };
const PM: SessionUser = { id: "p1", email: "p@x.com", fullName: "PM", role: "PROJECT_MANAGER", company: { id: "c1", name: "Co" } };

let currentUser: SessionUser = OWNER;
vi.mock("@/lib/auth/current-user", () => ({
  requireUser: async () => currentUser,
  getCurrentUser: async () => currentUser,
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: new Proxy({}, { get() { throw new Error("DB_TOUCHED"); } }),
}));
// Storage client is never reached in these tests, but the module imports it.
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({}) }));
vi.mock("@/lib/env", () => ({ isDemoMode: false }));

import * as actions from "./actions";

beforeEach(() => { currentUser = OWNER; });

const ownerOnly: { name: string; run: () => Promise<unknown> }[] = [
  { name: "updateCompanyProfile", run: () => actions.updateCompanyProfile({ name: "X" }) },
  { name: "updateBrandColors", run: () => actions.updateBrandColors({ primary: "#111111" }) },
  { name: "createBrandingUploadUrl(logo)", run: () => actions.createBrandingUploadUrl("logo", "image/png", 1000) },
  { name: "setBrandingAsset(logo)", run: () => actions.setBrandingAsset("logo", "c1/logo.png") },
  { name: "removeBrandingAsset(logo)", run: () => actions.removeBrandingAsset("logo") },
];

describe("branding authorization — owner-only company mutations", () => {
  for (const a of ownerOnly) {
    it(`${a.name} rejects a PROJECT_MANAGER with FORBIDDEN`, async () => {
      currentUser = PM;
      await expect(a.run()).rejects.toThrow("FORBIDDEN");
    });
  }

  it("owner passes the role guard (reaches the mocked DB, not authz)", async () => {
    currentUser = OWNER;
    await expect(actions.updateCompanyProfile({ name: "X" })).rejects.toThrow("DB_TOUCHED");
  });

  it("per-user assets are NOT owner-gated (a PM reaches the DB, not FORBIDDEN)", async () => {
    currentUser = PM;
    await expect(actions.removeBrandingAsset("signature")).rejects.toThrow("DB_TOUCHED");
  });
});
