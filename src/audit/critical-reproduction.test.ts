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

// ── Mock the data + auth layer (no DB is touched) ──────────────────────────
vi.mock("@/lib/auth/current-user", () => ({
  requireUser: vi.fn(async () => ({
    id: "u-owner",
    email: "owner@acme.test",
    fullName: "Owner",
    role: "OWNER",
    company: { id: "company-A", name: "Acme Builders" },
  })),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    project: { findFirst: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn() },
    vendor: { findFirst: vi.fn(), findUnique: vi.fn() },
    vendorPayment: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    purchaseOrder: { findFirst: vi.fn(), create: vi.fn() },
    company: { findUnique: vi.fn() },
    activityLog: { create: vi.fn() },
  },
}));

import { prisma } from "@/lib/db/prisma";
import * as procurement from "@/features/procurement/server/actions";
import * as projects from "@/features/projects/server/actions";

// Loose handle to the mocked client.
const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

beforeEach(() => {
  vi.clearAllMocks();
});

/* ═══════════════════════════════════════════════════════════════════════
 * CRITICAL #1 — Duplicate payment submission (no idempotency)
 * ═══════════════════════════════════════════════════════════════════════ */
describe("CRITICAL: duplicate payment submission", () => {
  const paymentInput = {
    vendorId: "vendor-1",
    projectId: "project-1",
    purchaseOrderId: null,
    amountPaise: 5_000_000,
    paymentMode: "CASH",
    referenceNumber: "TXN-DUP-001",
    date: "2026-07-20",
    remarks: null,
  };
  const paymentRow = {
    id: "pay-1", vendorId: "vendor-1", projectId: "project-1", purchaseOrderId: null,
    amountPaise: BigInt(5_000_000), paymentMode: "CASH", referenceNumber: "TXN-DUP-001",
    date: new Date("2026-07-20"), remarks: null, createdAt: new Date(),
    vendor: { businessName: "Vendor" }, project: { name: "Proj", code: "PRJ-1" },
    purchaseOrder: null, createdBy: { fullName: "Owner" },
  };

  it("records TWO identical payments from a double-submit — no dedup", async () => {
    db.project.findFirst.mockResolvedValue({ id: "project-1" }); // tenant project ok
    db.vendorPayment.create.mockResolvedValue(paymentRow);
    db.activityLog.create.mockResolvedValue({});

    // Simulate a double-click / retried request: identical payload twice.
    await procurement.createPayment(paymentInput as never);
    await procurement.createPayment(paymentInput as never);

    // REPRODUCED: both writes go through — the ledger is now double-counted.
    expect(db.vendorPayment.create).toHaveBeenCalledTimes(2);

    // Root cause: no idempotency read happens before the write.
    // EXPECTED AFTER FIX: a dedup lookup (findUnique on an idempotency key)
    // guards the second write. Today there is none.
    expect(db.vendorPayment.findUnique).not.toHaveBeenCalled();
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * CRITICAL #2 — Cross-tenant foreign-key ownership bypass
 * ═══════════════════════════════════════════════════════════════════════ */
describe("CRITICAL: cross-tenant FK ownership bypass", () => {
  it("creates a PO referencing a vendorId that is NEVER tenant-checked", async () => {
    db.project.findFirst.mockResolvedValue({ id: "project-1" }); // project belongs to company-A
    db.company.findUnique.mockResolvedValue({ settings: {} }); // approval not required
    db.purchaseOrder.findFirst.mockResolvedValue(null); // nextPoNumber + getPurchaseOrder
    db.purchaseOrder.create.mockResolvedValue({ id: "po-1" });

    const foreignVendorId = "vendor-owned-by-company-B";
    await procurement.createPurchaseOrder({
      vendorId: foreignVendorId,
      projectId: "project-1",
      purchaseDate: "2026-07-20",
      expectedDelivery: null,
      invoiceNumber: null,
      notes: null,
      lineItems: [{ material: "Cement", category: null, quantity: 10, unit: "bag", ratePaise: 40_000, gstRateBps: 1800 }],
    } as never);

    // REPRODUCED: the vendor is never loaded/verified against company-A.
    expect(db.vendor.findFirst).not.toHaveBeenCalled();
    expect(db.vendor.findUnique).not.toHaveBeenCalled();

    // The PO was written with the foreign tenant's vendorId.
    const createArg = db.purchaseOrder.create.mock.calls[0][0] as { data: { vendorId: string } };
    expect(createArg.data.vendorId).toBe(foreignVendorId);
    // EXPECTED AFTER FIX: createPurchaseOrder verifies the vendor belongs to
    // user.company.id (or the write throws) before persisting.
  });

  it("records a payment against another tenant's PO id without validation", async () => {
    db.project.findFirst.mockResolvedValue({ id: "project-1" });
    db.vendorPayment.create.mockResolvedValue({
      id: "pay-x", vendorId: "vendor-1", projectId: "project-1",
      purchaseOrderId: "po-owned-by-company-B", amountPaise: BigInt(1000), paymentMode: "CASH",
      referenceNumber: null, date: new Date(), remarks: null, createdAt: new Date(),
      vendor: { businessName: "V" }, project: { name: "P", code: "C" },
      purchaseOrder: { id: "po-owned-by-company-B", poNumber: "PO-9999" }, createdBy: { fullName: "O" },
    });
    db.activityLog.create.mockResolvedValue({});

    await procurement.createPayment({
      vendorId: "vendor-1", projectId: "project-1",
      purchaseOrderId: "po-owned-by-company-B",
      amountPaise: 1000, paymentMode: "CASH", referenceNumber: null,
      date: "2026-07-20", remarks: null,
    } as never);

    // REPRODUCED: purchaseOrderId is passed straight to create; no ownership read.
    expect(db.purchaseOrder.findFirst).not.toHaveBeenCalled();
    const arg = db.vendorPayment.create.mock.calls[0][0] as { data: { purchaseOrderId: string } };
    expect(arg.data.purchaseOrderId).toBe("po-owned-by-company-B");
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * CRITICAL #3 — Missing server-side validation (financial mutations)
 * ═══════════════════════════════════════════════════════════════════════ */
describe("CRITICAL: missing server-side validation", () => {
  it("createProject accepts an empty name and a NEGATIVE budget", async () => {
    db.project.findFirst.mockResolvedValue(null); // nextCode → PRJ-0001; getProject → null
    db.project.create.mockResolvedValue({ id: "project-1" });
    db.activityLog.create.mockResolvedValue({});

    await projects.createProject({
      name: "", // client schema requires min(2) — server does not re-check
      type: "RESIDENTIAL",
      budgetPaise: -999_999, // client schema requires min(0) — server does not re-check
      contractValuePaise: 0,
      tags: [],
    } as never);

    // REPRODUCED: the write happened with invalid data.
    expect(db.project.create).toHaveBeenCalledTimes(1);
    const arg = db.project.create.mock.calls[0][0] as { data: { name: string; budgetPaise: bigint } };
    expect(arg.data.name).toBe("");
    expect(arg.data.budgetPaise).toBe(BigInt(-999_999));
    // EXPECTED AFTER FIX: createProject runs projectFormSchema/an input schema
    // server-side and throws before reaching prisma.create.
  });

  it("createPayment accepts a negative amount server-side", async () => {
    db.project.findFirst.mockResolvedValue({ id: "project-1" });
    db.vendorPayment.create.mockResolvedValue({
      id: "pay-neg", vendorId: "vendor-1", projectId: "project-1", purchaseOrderId: null,
      amountPaise: BigInt(-100), paymentMode: "CASH", referenceNumber: null, date: new Date(),
      remarks: null, createdAt: new Date(), vendor: { businessName: "V" },
      project: { name: "P", code: "C" }, purchaseOrder: null, createdBy: { fullName: "O" },
    });
    db.activityLog.create.mockResolvedValue({});

    await procurement.createPayment({
      vendorId: "vendor-1", projectId: "project-1", purchaseOrderId: null,
      amountPaise: -100, paymentMode: "CASH", referenceNumber: null,
      date: "2026-07-20", remarks: null,
    } as never);

    const arg = db.vendorPayment.create.mock.calls[0][0] as { data: { amountPaise: bigint } };
    expect(arg.data.amountPaise).toBe(BigInt(-100)); // negative money accepted
  });
});
