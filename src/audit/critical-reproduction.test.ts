/**
 * AUDIT — Critical-issue reproduction suite.
 *
 * These tests drive the REAL server actions with Prisma + auth mocked, to
 * reproduce (not theorize) the Critical findings. They assert the CURRENT
 * (defective) behavior so the reproduction is explicit; each `EXPECTED AFTER
 * FIX` comment states what a corrected system must do. When a fix lands, flip
 * the marked assertion and the test becomes a permanent regression guard.
 *
 * Run: npx vitest run src/audit
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ALL_PERMISSIONS } from "@/features/rbac/permissions";

// ── Mock the data + auth layer (no DB is touched) ──────────────────────────
vi.mock("@/lib/auth/current-user", () => ({
  requireUser: vi.fn(async () => ({
    id: "u-owner",
    email: "owner@acme.test",
    fullName: "Owner",
    role: "OWNER",
    permissions: [...ALL_PERMISSIONS],
    company: { id: "company-A", name: "Acme Builders" },
  })),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    project: { findFirst: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn() },
    vendor: { findFirst: vi.fn(), findUnique: vi.fn() },
    vendorPayment: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    purchaseOrder: { findFirst: vi.fn(), create: vi.fn() },
    company: { findUnique: vi.fn() },
    activityLog: { create: vi.fn() },
  },
}));

import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma";
import * as procurement from "@/features/procurement/server/actions";
import * as projects from "@/features/projects/server/actions";

// Loose handle to the mocked client.
const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

beforeEach(() => {
  vi.clearAllMocks();
});

/* ═══════════════════════════════════════════════════════════════════════
 * FIXED #1 — Idempotent payment creation (no duplicates)
 * ═══════════════════════════════════════════════════════════════════════ */
describe("FIXED: idempotent payment creation", () => {
  const baseInput = {
    vendorId: "vendor-1", projectId: "project-1", purchaseOrderId: null,
    amountPaise: 5_000_000, paymentMode: "CASH", referenceNumber: "TXN-1",
    date: "2026-07-20", remarks: null,
  };
  const paymentRow = {
    id: "pay-1", vendorId: "vendor-1", projectId: "project-1", purchaseOrderId: null,
    amountPaise: BigInt(5_000_000), paymentMode: "CASH", referenceNumber: "TXN-1",
    date: new Date("2026-07-20"), remarks: null, createdAt: new Date(), clientUuid: "idem-1",
    vendor: { businessName: "Vendor" }, project: { name: "Proj", code: "PRJ-1" },
    purchaseOrder: null, createdBy: { fullName: "Owner" },
  };

  function tenantOk() {
    db.project.findFirst.mockResolvedValue({ id: "project-1" });
    db.vendor.findFirst.mockResolvedValue({ id: "vendor-1" });
    db.activityLog.create.mockResolvedValue({});
  }

  it("single submission → exactly one payment", async () => {
    tenantOk();
    db.vendorPayment.findFirst.mockResolvedValue(null); // no prior payment
    db.vendorPayment.create.mockResolvedValue(paymentRow);

    await procurement.createPayment({ ...baseInput, clientUuid: "idem-1" } as never);

    expect(db.vendorPayment.create).toHaveBeenCalledTimes(1);
  });

  it("double-click (same clientUuid) → one payment, second is deduped", async () => {
    tenantOk();
    db.vendorPayment.findFirst
      .mockResolvedValueOnce(null) // 1st: no prior → create
      .mockResolvedValueOnce(paymentRow); // 2nd: prior found → return it
    db.vendorPayment.create.mockResolvedValue(paymentRow);

    const r1 = await procurement.createPayment({ ...baseInput, clientUuid: "idem-1" } as never);
    const r2 = await procurement.createPayment({ ...baseInput, clientUuid: "idem-1" } as never);

    expect(db.vendorPayment.create).toHaveBeenCalledTimes(1);
    expect(r1.id).toBe(r2.id);
  });

  it("retry after a timeout (same clientUuid) → one payment (no write)", async () => {
    tenantOk();
    db.vendorPayment.findFirst.mockResolvedValue(paymentRow); // first attempt already persisted
    db.vendorPayment.create.mockResolvedValue(paymentRow);

    await procurement.createPayment({ ...baseInput, clientUuid: "idem-1" } as never);

    expect(db.vendorPayment.create).not.toHaveBeenCalled(); // deduped before any write
  });

  it("concurrent race (unique-index P2002) → one payment, no error", async () => {
    tenantOk();
    db.vendorPayment.findFirst
      .mockResolvedValueOnce(null) // dedup check passes (both racers see null)
      .mockResolvedValueOnce(paymentRow); // post-P2002 lookup returns the winner
    db.vendorPayment.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "6.19.3",
      }),
    );

    const r = await procurement.createPayment({ ...baseInput, clientUuid: "idem-1" } as never);
    expect(r.id).toBe("pay-1"); // returns the existing payment instead of throwing
  });

  it("different clientUuid → a new payment", async () => {
    tenantOk();
    db.vendorPayment.findFirst.mockResolvedValue(null);
    db.vendorPayment.create.mockResolvedValue(paymentRow);

    await procurement.createPayment({ ...baseInput, clientUuid: "idem-A" } as never);
    await procurement.createPayment({ ...baseInput, clientUuid: "idem-B" } as never);

    expect(db.vendorPayment.create).toHaveBeenCalledTimes(2);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * FIXED #2 — Cross-tenant foreign-key ownership is now rejected
 * ═══════════════════════════════════════════════════════════════════════ */
describe("FIXED: cross-tenant FK ownership is rejected", () => {
  it("rejects a PO referencing a vendorId from another company (no write)", async () => {
    db.project.findFirst.mockResolvedValue({ id: "project-1" }); // project belongs to company-A
    db.vendor.findFirst.mockResolvedValue(null); // vendor NOT in company-A
    db.company.findUnique.mockResolvedValue({ settings: {} });
    db.purchaseOrder.findFirst.mockResolvedValue(null);
    db.purchaseOrder.create.mockResolvedValue({ id: "po-1" });

    await expect(
      procurement.createPurchaseOrder({
        vendorId: "vendor-owned-by-company-B",
        projectId: "project-1",
        purchaseDate: "2026-07-20",
        expectedDelivery: null,
        invoiceNumber: null,
        notes: null,
        lineItems: [{ material: "Cement", category: null, quantity: 10, unit: "bag", ratePaise: 40_000, gstRateBps: 1800 }],
      } as never),
    ).rejects.toThrow();

    // FIXED: the vendor is tenant-checked, and no PO is written.
    expect(db.vendor.findFirst).toHaveBeenCalled();
    expect(db.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it("rejects a payment against another company's PO id (no write)", async () => {
    db.project.findFirst.mockResolvedValue({ id: "project-1" });
    db.vendor.findFirst.mockResolvedValue({ id: "vendor-1" }); // vendor ok in company-A
    db.purchaseOrder.findFirst.mockResolvedValue(null); // PO NOT in company-A
    db.vendorPayment.create.mockResolvedValue({});

    await expect(
      procurement.createPayment({
        vendorId: "vendor-1", projectId: "project-1",
        purchaseOrderId: "po-owned-by-company-B",
        amountPaise: 1000, paymentMode: "CASH", referenceNumber: null,
        date: "2026-07-20", remarks: null,
      } as never),
    ).rejects.toThrow();

    // FIXED: the PO ownership is checked, and no payment is written.
    expect(db.purchaseOrder.findFirst).toHaveBeenCalled();
    expect(db.vendorPayment.create).not.toHaveBeenCalled();
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * FIXED #3 — Server-side validation rejects invalid financial input
 * ═══════════════════════════════════════════════════════════════════════ */
describe("FIXED: server-side validation rejects invalid input", () => {
  it("rejects an empty name / negative budget on createProject (no write)", async () => {
    db.project.findFirst.mockResolvedValue(null);
    db.project.create.mockResolvedValue({ id: "project-1" });
    db.activityLog.create.mockResolvedValue({});

    await expect(
      projects.createProject({
        name: "", // fails min(2)
        type: "RESIDENTIAL",
        budgetPaise: -999_999, // fails min(0)
        contractValuePaise: 0,
        tags: [],
      } as never),
    ).rejects.toThrow();

    // FIXED: validation throws before any write.
    expect(db.project.create).not.toHaveBeenCalled();
  });

  it("rejects a negative amount on createPayment (no write)", async () => {
    db.project.findFirst.mockResolvedValue({ id: "project-1" });
    db.vendor.findFirst.mockResolvedValue({ id: "vendor-1" });
    db.vendorPayment.create.mockResolvedValue({});
    db.activityLog.create.mockResolvedValue({});

    await expect(
      procurement.createPayment({
        vendorId: "11111111-1111-1111-1111-111111111111",
        projectId: "22222222-2222-2222-2222-222222222222",
        purchaseOrderId: null,
        amountPaise: -100, // fails positive()
        paymentMode: "CASH", referenceNumber: null,
        date: "2026-07-20", remarks: null,
      } as never),
    ).rejects.toThrow();

    // FIXED: validation throws before any write.
    expect(db.vendorPayment.create).not.toHaveBeenCalled();
  });
});
