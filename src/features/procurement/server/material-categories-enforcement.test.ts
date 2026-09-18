import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS, type Permission } from "@/features/rbac/permissions";
import { DEFAULT_MATERIAL_CATEGORIES } from "../constants";

/**
 * The material category list is company-wide procurement configuration: it
 * classifies every purchase order line and drives every procurement filter and
 * analytics breakdown. It used to be writable by ANY authenticated member,
 * whatever their role — `setMaterialCategories` called `requireUser()` and
 * nothing else. These tests pin the fix, and pin the thing the fix must not
 * break: reading the list has to stay open, because the PO editor's category
 * dropdown loads it on every single purchase order.
 */

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
const OWNER = user([...ALL_PERMISSIONS]);

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    company: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    activityLog: { create: vi.fn() },
  },
}));
vi.mock("@/lib/auth/current-user", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("UNAUTHENTICATED");
    return h.user;
  },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));

import { listMaterialCategories, setMaterialCategories } from "./actions";

/** What the settings column holds once categories have been configured. */
const STORED = ["Cement", "Steel", "Tiles"];

beforeEach(() => {
  h.user = OWNER;
  Object.values(h.prisma).forEach((m) =>
    Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset()),
  );
  h.prisma.company.findUnique.mockResolvedValue({ settings: { materialCategories: STORED } });
  h.prisma.company.findUniqueOrThrow.mockResolvedValue({ settings: { poApprovalRequired: true } });
  h.prisma.company.update.mockResolvedValue({});
  h.prisma.activityLog.create.mockResolvedValue({});
});

describe("setMaterialCategories — the authorization gap", () => {
  it("refuses a member holding no permissions at all", async () => {
    h.user = user([]);
    await expect(setMaterialCategories(["Anything"])).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.company.update).not.toHaveBeenCalled();
  });

  it("refuses a Project Manager — the exact case that used to get through", async () => {
    // A PM can view and add materials, and raise purchase orders. None of that
    // is authority over the company-wide taxonomy.
    h.user = user(["materials.view", "materials.create", "purchase_orders.create", "company.view"]);
    await expect(setMaterialCategories(["Wrecked"])).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.company.update).not.toHaveBeenCalled();
  });

  it("refuses someone who can edit the COMPANY but not the catalogue", async () => {
    // company.edit is the company's legal/tax identity — a different authority.
    h.user = user(["company.view", "company.edit", "company.branding"]);
    await expect(setMaterialCategories(["Nope"])).rejects.toThrow("FORBIDDEN");
  });

  it("refuses an unauthenticated caller", async () => {
    h.user = null;
    await expect(setMaterialCategories(["Nope"])).rejects.toThrow("UNAUTHENTICATED");
  });

  it("allows materials.edit, and writes the cleaned list", async () => {
    h.user = user(["materials.edit"]);
    const result = await setMaterialCategories(["  Cement ", "Steel", "Cement", "", "Tiles"]);

    // Trimmed, de-duplicated, blanks dropped — unchanged behaviour.
    expect(result).toEqual(["Cement", "Steel", "Tiles"]);
    expect(h.prisma.company.update).toHaveBeenCalledTimes(1);
    const arg = h.prisma.company.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "c1" });
    expect(arg.data.settings.materialCategories).toEqual(["Cement", "Steel", "Tiles"]);
    // Other settings keys survive the merge.
    expect(arg.data.settings.poApprovalRequired).toBe(true);
  });

  it("allows an Owner", async () => {
    h.user = OWNER;
    await expect(setMaterialCategories(["Cement"])).resolves.toEqual(["Cement"]);
  });

  it("records an audit entry naming what changed", async () => {
    // Previously this rewrote company-wide configuration leaving no trace at all.
    h.user = user(["materials.edit"]);
    await setMaterialCategories(["Cement", "Steel", "Tiles", "Glass"]);

    expect(h.prisma.activityLog.create).toHaveBeenCalledTimes(1);
    const entry = h.prisma.activityLog.create.mock.calls[0][0].data;
    expect(entry.action).toBe("material_categories.updated");
    expect(entry.actorId).toBe("u1");
    expect(entry.companyId).toBe("c1");
    expect(entry.meta.added).toEqual(["Glass"]);
    expect(entry.meta.removed).toEqual([]);
    expect(entry.meta.categories).toEqual(["Cement", "Steel", "Tiles", "Glass"]);
  });

  it("records removals too", async () => {
    h.user = user(["materials.edit"]);
    await setMaterialCategories(["Cement"]);
    const entry = h.prisma.activityLog.create.mock.calls[0][0].data;
    expect(entry.meta.removed.sort()).toEqual(["Steel", "Tiles"]);
  });

  it("writes no audit entry when the caller was refused", async () => {
    h.user = user([]);
    await expect(setMaterialCategories(["Nope"])).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.activityLog.create).not.toHaveBeenCalled();
  });

  it("does not accept materials.archive as a substitute for edit", async () => {
    h.user = user(["materials.view", "materials.create", "materials.archive"]);
    await expect(setMaterialCategories(["Nope"])).rejects.toThrow("FORBIDDEN");
  });
});

describe("listMaterialCategories — reading stays open", () => {
  it("serves a member with no permissions, so the PO editor keeps working", async () => {
    h.user = user([]);
    await expect(listMaterialCategories()).resolves.toEqual(STORED);
  });

  it("serves a PO creator who cannot write the list", async () => {
    h.user = user(["purchase_orders.view", "purchase_orders.create"]);
    await expect(listMaterialCategories()).resolves.toEqual(STORED);
  });

  it("still refuses an unauthenticated caller", async () => {
    h.user = null;
    await expect(listMaterialCategories()).rejects.toThrow("UNAUTHENTICATED");
  });

  it("first-run seeding does NOT require materials.edit", async () => {
    // The regression this guards: routing the lazy seed through the gated
    // setter would make the FIRST purchase order raised in a fresh company fail
    // with FORBIDDEN for everyone except a materials.edit holder.
    h.prisma.company.findUnique.mockResolvedValue({ settings: {} });
    h.user = user(["purchase_orders.create"]);

    const seeded = await listMaterialCategories();

    expect(seeded).toEqual([...DEFAULT_MATERIAL_CATEGORIES]);
    expect(h.prisma.company.update).toHaveBeenCalledTimes(1);
  });

  it("the seed can only ever write the built-in presets", async () => {
    h.prisma.company.findUnique.mockResolvedValue({ settings: {} });
    h.user = user([]);

    await listMaterialCategories();

    const written = h.prisma.company.update.mock.calls[0][0].data.settings.materialCategories;
    expect(written).toEqual([...DEFAULT_MATERIAL_CATEGORIES]);
  });
});
