import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS, type Permission } from "@/features/rbac/permissions";

function u(permissions: Permission[]): SessionUser {
  return { id: "pm1", email: "u@x.com", fullName: "U", role: "PROJECT_MANAGER", permissions, company: { id: "c1", name: "Co" } };
}
const OWNER = u([...ALL_PERMISSIONS]);

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    vendorPayment: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
    project: { findFirst: vi.fn() },
    vendor: { findFirst: vi.fn() },
    activityLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/auth/current-user", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("UNAUTHENTICATED");
    return h.user;
  },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));

import { listPayments, createPayment, deletePayment } from "./actions";
import type { CreatePaymentInput } from "../types";

const validInput: CreatePaymentInput = {
  vendorId: "v1",
  projectId: "p1",
  amountPaise: 5000,
  paymentMode: "CASH",
  date: "2026-07-20",
};

beforeEach(() => {
  h.user = OWNER;
  Object.values(h.prisma).forEach((m) => {
    if (typeof m === "object") Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset?.());
  });
  h.prisma.vendorPayment.findMany.mockResolvedValue([]);
});

describe("createPayment — create permission + project ownership", () => {
  it("blocks a user without payments.create", async () => {
    h.user = u(["payments.view"]);
    await expect(createPayment(validInput)).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.vendorPayment.create).not.toHaveBeenCalled();
  });

  it("blocks recording a payment on a project the PM is not assigned to", async () => {
    h.user = u(["payments.view", "payments.create"]);
    h.prisma.project.findFirst.mockResolvedValue(null); // no access
    await expect(createPayment(validInput)).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.vendorPayment.create).not.toHaveBeenCalled();
  });
});

describe("deletePayment — dedicated delete permission", () => {
  it("blocks a PM (view + create, but no payments.delete)", async () => {
    h.user = u(["payments.view", "payments.create"]);
    await expect(deletePayment("pay1")).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.vendorPayment.findFirst).not.toHaveBeenCalled();
  });

  it("with payments.delete but no view_all, cannot delete another PM's payment", async () => {
    h.user = u(["payments.view", "payments.delete"]);
    h.prisma.vendorPayment.findFirst.mockResolvedValue({
      id: "pay1", vendorId: "v1", projectId: "p1", amountPaise: BigInt(1), project: { pmId: "someone-else" },
    });
    await expect(deletePayment("pay1")).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("listPayments — view scope", () => {
  it("scopes a PM without payments.view_all to their projects", async () => {
    h.user = u(["payments.view"]);
    await listPayments();
    const where = h.prisma.vendorPayment.findMany.mock.calls[0][0].where;
    expect(where.project).toEqual({ pmId: "pm1" });
  });

  it("payments.view_all removes the project scope", async () => {
    h.user = u(["payments.view", "payments.view_all"]);
    await listPayments();
    const where = h.prisma.vendorPayment.findMany.mock.calls[0][0].where;
    expect(where.project).toBeUndefined();
  });
});
