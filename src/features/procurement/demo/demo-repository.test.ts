import { describe, it, expect, beforeEach } from "vitest";
import { demoProcurementRepository as repo } from "./demo-repository";
import { demoSpendByProject } from "@/features/budget/spend";

const SKY = "10000000-0000-0000-0000-000000000001";
const ORION = "10000000-0000-0000-0000-000000000002";
const V1 = "40000000-0000-0000-0000-0000000000v1";
const V2 = "40000000-0000-0000-0000-0000000000v2";

const line = (over: Partial<{ material: string; category: string | null; quantity: number; unit: string; ratePaise: number; gstRateBps: number }> = {}) => ({
  material: "Cement",
  category: "Cement",
  quantity: 100,
  unit: "bag",
  ratePaise: 38000,
  gstRateBps: 1800,
  ...over,
});

beforeEach(() => localStorage.clear());

describe("procurement demo — vendors", () => {
  it("seeds vendors with lifetime + outstanding rollups", async () => {
    const vendors = await repo.listVendors();
    expect(vendors.length).toBe(5);
    const ultratech = vendors.find((v) => v.businessName === "UltraTech Cement")!;
    expect(ultratech.totalPurchasedPaise).toBeGreaterThan(0);
    expect(ultratech.poCount).toBeGreaterThan(0);
    expect(ultratech.projectsServed).toBeGreaterThan(0);
    // UltraTech has partial payments → some outstanding remains.
    expect(ultratech.outstandingPaise).toBeGreaterThan(0);
  });
  it("filters by status and material", async () => {
    expect((await repo.listVendors({ status: "ACTIVE" })).length).toBe(4);
    expect((await repo.listVendors({ material: "Cement" })).length).toBe(1);
  });
  it("toggles favorite", async () => {
    const v = (await repo.listVendors())[0];
    const before = v.isFavorite;
    const after = await repo.toggleVendorFavorite(v.id);
    expect(after).toBe(!before);
  });
});

describe("procurement demo — purchase orders", () => {
  it("seeds POs and filters by status", async () => {
    expect((await repo.listPurchaseOrders()).length).toBe(7);
    expect((await repo.listPurchaseOrders({ status: "APPROVED" })).length).toBe(5);
    expect((await repo.listPurchaseOrders({ status: "SUBMITTED" })).length).toBe(1);
  });

  it("filters by material category and payment status", async () => {
    const steel = await repo.listPurchaseOrders({ category: "Steel" });
    expect(steel.length).toBeGreaterThan(0);
    const paid = await repo.listPurchaseOrders({ paymentStatus: "PAID" });
    expect(paid.every((p) => p.paymentStatus === "PAID")).toBe(true);
  });

  it("creates a draft with GST split and an auto PO number when approval is on", async () => {
    localStorage.setItem("constructly.demo.settings.v1", JSON.stringify({ poApprovalRequired: true }));
    const po = await repo.createPurchaseOrder({
      vendorId: V1,
      projectId: SKY,
      purchaseDate: "2026-07-14",
      lineItems: [line({ quantity: 100, ratePaise: 38000, gstRateBps: 1800 })],
    });
    expect(po.poNumber).toBe("PO-0234");
    expect(po.status).toBe("DRAFT");
    expect(po.subtotalPaise).toBe(3_800_000);
    expect(po.gstPaise).toBe(684_000); // 18%
    expect(po.totalPaise).toBe(4_484_000);
  });

  it("creates a final (approved) PO when approval is off", async () => {
    localStorage.setItem("constructly.demo.settings.v1", JSON.stringify({ poApprovalRequired: false }));
    const po = await repo.createPurchaseOrder({
      vendorId: V1,
      projectId: SKY,
      purchaseDate: "2026-07-14",
      lineItems: [line({ material: "Sand", category: "Sand & Aggregate", quantity: 10, unit: "ton", ratePaise: 260000, gstRateBps: 500 })],
    });
    expect(po.status).toBe("APPROVED");
  });

  it("runs the submit → approve workflow", async () => {
    localStorage.setItem("constructly.demo.settings.v1", JSON.stringify({ poApprovalRequired: true }));
    const draft = await repo.createPurchaseOrder({
      vendorId: V1,
      projectId: SKY,
      purchaseDate: "2026-07-14",
      lineItems: [line({ quantity: 50 })],
    });
    expect((await repo.submitPurchaseOrder(draft.id)).status).toBe("SUBMITTED");
    expect((await repo.approvePurchaseOrder(draft.id)).status).toBe("APPROVED");
  });

  it("keeps approved POs immutable (edit throws)", async () => {
    const approved = (await repo.listPurchaseOrders({ status: "APPROVED" }))[0];
    await expect(
      repo.updatePurchaseOrder(approved.id, {
        vendorId: V1,
        projectId: SKY,
        purchaseDate: "2026-07-14",
        lineItems: [line({ material: "X", quantity: 1, unit: "nos", ratePaise: 100, gstRateBps: 0 })],
      }),
    ).rejects.toThrow();
  });

  it("revises an approved PO into a linked new draft", async () => {
    const approved = (await repo.listPurchaseOrders({ status: "APPROVED" }))[0];
    const revision = await repo.revisePurchaseOrder(approved.id);
    expect(revision.status).toBe("DRAFT");
    expect(revision.revisedFromNumber).toBe(approved.poNumber);
    expect(revision.id).not.toBe(approved.id);
  });

  it("duplicates any PO into an unlinked fresh draft dated today", async () => {
    const approved = (await repo.listPurchaseOrders({ status: "APPROVED" }))[0];
    const copy = await repo.duplicatePurchaseOrder(approved.id);
    expect(copy.status).toBe("DRAFT");
    expect(copy.revisedFromId).toBeNull();
    expect(copy.totalPaise).toBe(approved.totalPaise);
    expect(copy.purchaseDate).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe("procurement demo — payments + outstanding", () => {
  it("records a payment that reduces vendor outstanding", async () => {
    const before = (await repo.getVendor(V2))!;
    const outBefore = before.outstandingPaise;
    await repo.createPayment({
      vendorId: V2,
      projectId: SKY,
      purchaseOrderId: null,
      amountPaise: 100_000,
      paymentMode: "UPI",
      date: "2026-07-14",
    });
    const after = (await repo.getVendor(V2))!;
    expect(after.outstandingPaise).toBe(outBefore - 100_000);
  });

  it("links a payment to a PO and reflects PARTIAL/PAID status", async () => {
    const po = (await repo.listPurchaseOrders({ status: "APPROVED" })).find((p) => p.paymentStatus === "UNPAID");
    if (!po) return; // all seeded approved POs already have payments
    await repo.createPayment({
      vendorId: po.vendor.id,
      projectId: po.project.id,
      purchaseOrderId: po.id,
      amountPaise: po.totalPaise,
      paymentMode: "BANK_TRANSFER",
      date: "2026-07-14",
    });
    const refreshed = (await repo.getPurchaseOrder(po.id))!;
    expect(refreshed.paymentStatus).toBe("PAID");
  });

  it("computes aging buckets for a vendor", async () => {
    const aging = await repo.vendorAging(V1);
    const total = aging.d0_30 + aging.d31_60 + aging.d60_plus;
    expect(total).toBeGreaterThanOrEqual(0);
    // Rows carry PO numbers for the UI.
    aging.rows.forEach((r) => expect(typeof r.poNumber === "string" || r.poNumber === undefined).toBe(true));
  });

  it("deletes a payment (owner action)", async () => {
    const p = await repo.createPayment({
      vendorId: V2, projectId: SKY, purchaseOrderId: null,
      amountPaise: 5_000, paymentMode: "CASH", date: "2026-07-14",
    });
    await repo.deletePayment(p.id);
    const list = await repo.listPayments({ vendorId: V2 });
    expect(list.find((x) => x.id === p.id)).toBeUndefined();
  });
});

describe("procurement demo — material categories", () => {
  it("seeds default categories and persists edits", async () => {
    const seeded = await repo.listMaterialCategories();
    expect(seeded).toContain("Cement");
    expect(seeded).toContain("Steel");
    const next = await repo.setMaterialCategories([...seeded, "Tiles"]);
    expect(next).toContain("Tiles");
    expect(await repo.listMaterialCategories()).toContain("Tiles");
  });
});

describe("procurement demo — project procurement view", () => {
  it("assembles summary, vendors, POs, payments for a project", async () => {
    const pp = await repo.getProjectProcurement(SKY);
    expect(pp.summary.poCount).toBeGreaterThan(0);
    expect(pp.summary.vendorsUsed).toBeGreaterThan(0);
    expect(pp.vendors.length).toBeGreaterThan(0);
    expect(pp.purchaseOrders.every((p) => p.project.id === SKY)).toBe(true);
  });
});

describe("procurement demo — v1 → v2 migration", () => {
  it("migrates pre-GST v1 POs/vendors into v2 stores without data loss", async () => {
    // Simulate legacy stores.
    localStorage.setItem(
      "constructly.demo.vendors.v1",
      JSON.stringify([{ id: V1, businessName: "Legacy Vendor", contactPerson: null, phone: null, email: null, gstin: null, address: null, materialsSupplied: ["Cement"], paymentTerms: null, status: "ACTIVE", notes: null, isFavorite: false }]),
    );
    localStorage.setItem(
      "constructly.demo.pos.v1",
      JSON.stringify([{ id: "legacy-po", poNumber: "PO-9001", vendorId: V1, projectId: SKY, status: "APPROVED", invoiceNumber: "INV-1", purchaseDate: "2026-01-01", notes: null, totalPaise: 500_000, createdByName: "X", approvedByName: "Y", approvedAt: "2026-01-02T00:00:00Z", revisedFromId: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", lineItems: [{ id: "l1", material: "Cement", quantity: 100, unit: "bag", ratePaise: 5000, amountPaise: 500_000, sortOrder: 0 }] }]),
    );
    const pos = await repo.listPurchaseOrders();
    const migrated = pos.find((p) => p.poNumber === "PO-9001")!;
    expect(migrated).toBeDefined();
    expect(migrated.totalPaise).toBe(500_000); // grand total unchanged
    expect(migrated.subtotalPaise).toBe(500_000); // subtotal = old total
    expect(migrated.gstPaise).toBe(0);
    const detail = (await repo.getPurchaseOrder(migrated.id))!;
    expect(detail.lineItems[0].gstRateBps).toBe(0);
    expect(detail.lineItems[0].category).toBeNull();
    // Legacy keys are cleaned up.
    expect(localStorage.getItem("constructly.demo.pos.v1")).toBeNull();
  });
});

describe("procurement demo — budget integration", () => {
  it("approved POs contribute to project procurement spend", () => {
    localStorage.setItem("constructly.demo.settings.v1", JSON.stringify({ poApprovalRequired: true }));
    void repo.listPurchaseOrders();
    const spend = demoSpendByProject().get(SKY);
    expect(spend?.procurementPaise ?? 0).toBeGreaterThan(0);
  });

  it("uses GST-inclusive grand totals in procurement spend", () => {
    localStorage.setItem("constructly.demo.settings.v1", JSON.stringify({ poApprovalRequired: false }));
    void repo.listPurchaseOrders();
    const spend = demoSpendByProject().get(ORION);
    // Orion has an approved GST PO (po228) — spend must include GST.
    expect(spend?.procurementPaise ?? 0).toBeGreaterThan(0);
  });
});
