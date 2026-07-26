import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";

/**
 * Server-side authorization tests. The owner-only guards (`assertOwner`) run
 * before any database access, so mocking the auth layer alone proves the role
 * matrix: PROJECT_MANAGERs are refused owner-scoped financial mutations even if
 * UI gating is bypassed. This is the "never trust the client" backstop (RLS is
 * the third layer, verified separately against Postgres).
 */

const OWNER: SessionUser = { id: "o1", email: "o@x.com", fullName: "Owner", role: "OWNER", company: { id: "c1", name: "Co" } };
const PM: SessionUser = { id: "p1", email: "p@x.com", fullName: "PM", role: "PROJECT_MANAGER", company: { id: "c1", name: "Co" } };

let currentUser: SessionUser = OWNER;
vi.mock("@/lib/auth/current-user", () => ({
  requireUser: async () => currentUser,
  getCurrentUser: async () => currentUser,
}));
// Guard the test from ever hitting a real client: any prisma access throws.
vi.mock("@/lib/db/prisma", () => ({
  prisma: new Proxy({}, { get() { throw new Error("DB_TOUCHED"); } }),
}));

import * as actions from "./actions";

beforeEach(() => { currentUser = OWNER; });

// deletePurchaseOrder is intentionally NOT here: its authorization is
// data-dependent (a PM may delete their own DRAFT), so it fetches the PO before
// deciding via poDeleteAction — that policy's role matrix is covered in
// deletion.test.ts. archive/unarchive remain strict owner-only (assertOwner first).
const ownerOnly: { name: string; run: () => Promise<unknown> }[] = [
  { name: "createVendor", run: () => actions.createVendor({ businessName: "Acme" }) },
  { name: "updateVendor", run: () => actions.updateVendor("v1", { businessName: "New" }) },
  { name: "setVendorStatus", run: () => actions.setVendorStatus("v1", "INACTIVE") },
  { name: "approvePurchaseOrder", run: () => actions.approvePurchaseOrder("po1") },
  { name: "archivePurchaseOrder", run: () => actions.archivePurchaseOrder("po1") },
  { name: "unarchivePurchaseOrder", run: () => actions.unarchivePurchaseOrder("po1") },
  { name: "deletePayment", run: () => actions.deletePayment("pay1") },
];

describe("procurement authorization — owner-only mutations", () => {
  for (const a of ownerOnly) {
    it(`${a.name} rejects a PROJECT_MANAGER with FORBIDDEN`, async () => {
      currentUser = PM;
      await expect(a.run()).rejects.toThrow("FORBIDDEN");
    });
  }

  it("owner passes the role guard (fails later at the mocked DB, not at authz)", async () => {
    currentUser = OWNER;
    // Reaching the DB proves the role guard let the owner through.
    await expect(actions.createVendor({ businessName: "Acme" })).rejects.toThrow("DB_TOUCHED");
  });
});
