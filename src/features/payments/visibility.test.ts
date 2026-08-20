import { describe, it, expect } from "vitest";
import { paymentsVisibilityFor, seesAllProjects } from "./visibility";
import type { Permission } from "@/features/rbac/permissions";
import type { SessionUser } from "@/lib/auth/types";

/**
 * The Payments Centre is one page showing four modules' money, so "who may see
 * this page" and "what may they see on it" are two different questions. Getting
 * them confused is how a storekeeper with `payments.view` would be handed the
 * contractor advance ledger.
 */

function user(permissions: Permission[], role: SessionUser["role"] = "PROJECT_MANAGER"): SessionUser {
  return {
    id: "u1",
    email: "u@example.com",
    fullName: "Test User",
    role,
    permissions,
    company: { id: "co", name: "Co" },
  };
}

describe("paymentsVisibilityFor", () => {
  it("grants each instrument only through the module that owns it", () => {
    expect(paymentsVisibilityFor(user(["payments.view"]))).toEqual({
      vendorPayments: true,
      agreementPayments: false,
      contractorLedger: false,
      companyWideAdvances: false,
    });
  });

  it("does not let vendor-payment access imply contractor access", () => {
    const v = paymentsVisibilityFor(user(["payments.view", "payments.view_all"]));
    expect(v.contractorLedger).toBe(false);
    expect(v.agreementPayments).toBe(false);
  });

  it("reserves company-wide advances for contractors.view_all", () => {
    // `contractors.view` is project-scoped by design, and an advance with no
    // project cannot be contained by a project filter — so it follows the
    // ledger's own rule rather than a looser one invented for this page.
    expect(paymentsVisibilityFor(user(["contractors.view"])).companyWideAdvances).toBe(false);
    expect(
      paymentsVisibilityFor(user(["contractors.view", "contractors.view_all"]))
        .companyWideAdvances,
    ).toBe(true);
  });

  it("grants nothing to an unauthenticated caller", () => {
    expect(paymentsVisibilityFor(null)).toEqual({
      vendorPayments: false,
      agreementPayments: false,
      contractorLedger: false,
      companyWideAdvances: false,
    });
  });
});

describe("seesAllProjects", () => {
  it("is true for an owner", () => {
    expect(seesAllProjects(user([], "OWNER"))).toBe(true);
  });

  it("is true for a cross-project view permission", () => {
    expect(seesAllProjects(user(["projects.view_all"]))).toBe(true);
    expect(seesAllProjects(user(["payments.view_all"]))).toBe(true);
  });

  it("is false for an ordinary project manager", () => {
    expect(seesAllProjects(user(["payments.view", "contractors.view"]))).toBe(false);
  });

  it("is false with no session", () => {
    expect(seesAllProjects(null)).toBe(false);
  });
});
