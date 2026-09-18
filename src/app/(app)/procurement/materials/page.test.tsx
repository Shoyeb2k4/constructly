/**
 * The route guard for the administrative Material Master.
 *
 * The distinction this pins is the one Pass 2 and Pass 3 were careful about:
 * the SERVER lets a purchase-order creator READ material options so they are
 * never blocked mid-order, but that is not authority to administer the
 * catalogue. This page must require `materials.view` specifically — otherwise
 * the wider read set would quietly become the admin gate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { Permission } from "@/features/rbac/permissions";

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  redirected: [] as string[],
}));

// Next's redirect() throws to unwind the render; record where it aimed.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    h.redirected.push(to);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => h.user }));
vi.mock("@/features/procurement/components/material-master-view", () => ({
  MaterialMasterView: () => null,
}));

import MaterialMasterPage from "./page";

function user(permissions: Permission[]): SessionUser {
  return {
    id: "u1",
    email: "u@x.com",
    fullName: "U",
    role: "PROJECT_MANAGER",
    permissions,
    company: { id: "c1", name: "Co" },
  };
}

beforeEach(() => {
  h.redirected = [];
});

describe("materials page access", () => {
  it("renders for a user holding materials.view", async () => {
    h.user = user(["materials.view"]);
    await expect(MaterialMasterPage()).resolves.toBeTruthy();
    expect(h.redirected).toEqual([]);
  });

  it("redirects a purchase-order creator who cannot view the master", async () => {
    // They can still PICK a material while raising an order — that is the
    // server's wider read set, deliberately not this page's gate.
    h.user = user(["purchase_orders.create", "purchase_orders.view", "vendors.view"]);
    await expect(MaterialMasterPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(h.redirected).toEqual(["/dashboard"]);
  });

  it("redirects someone who can only create or archive but not view", async () => {
    h.user = user(["materials.create", "materials.archive"]);
    await expect(MaterialMasterPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(h.redirected).toEqual(["/dashboard"]);
  });

  it("redirects a signed-out visitor", async () => {
    h.user = null;
    await expect(MaterialMasterPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(h.redirected).toEqual(["/dashboard"]);
  });
});
