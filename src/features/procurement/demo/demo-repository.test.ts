import { describe, it, expect, beforeEach } from "vitest";
import { demoProcurementRepository as repo } from "./demo-repository";
import { demoSpendByProject } from "@/features/budget/spend";

const SKY = "10000000-0000-0000-0000-000000000001";

beforeEach(() => localStorage.clear());

describe("procurement demo — vendors", () => {
  it("seeds vendors with lifetime rollups", async () => {
    const vendors = await repo.listVendors();
    expect(vendors.length).toBe(5);
    const ultratech = vendors.find((v) => v.businessName === "UltraTech Cement")!;
    expect(ultratech.totalPurchasedPaise).toBeGreaterThan(0);
    expect(ultratech.poCount).toBeGreaterThan(0);
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
    expect((await repo.listPurchaseOrders()).length).toBe(5);
    expect((await repo.listPurchaseOrders({ status: "APPROVED" })).length).toBe(3);
  });

  it("creates a draft with an auto PO number when approval is on", async () => {
    localStorage.setItem("constructly.demo.settings.v1", JSON.stringify({ poApprovalRequired: true }));
    const po = await repo.createPurchaseOrder({
      vendorId: "40000000-0000-0000-0000-0000000000v1",
      projectId: SKY,
      purchaseDate: "2026-07-14",
      lineItems: [{ material: "Cement", quantity: 100, unit: "bag", ratePaise: 38000 }],
    });
    expect(po.poNumber).toBe("PO-0234");
    expect(po.status).toBe("DRAFT");
    expect(po.totalPaise).toBe(3_800_000);
  });

  it("creates a final (approved) PO when approval is off", async () => {
    localStorage.setItem("constructly.demo.settings.v1", JSON.stringify({ poApprovalRequired: false }));
    const po = await repo.createPurchaseOrder({
      vendorId: "40000000-0000-0000-0000-0000000000v1",
      projectId: SKY,
      purchaseDate: "2026-07-14",
      lineItems: [{ material: "Sand", quantity: 10, unit: "ton", ratePaise: 260000 }],
    });
    expect(po.status).toBe("APPROVED");
  });

  it("runs the submit → approve workflow", async () => {
    localStorage.setItem("constructly.demo.settings.v1", JSON.stringify({ poApprovalRequired: true }));
    const draft = await repo.createPurchaseOrder({
      vendorId: "40000000-0000-0000-0000-0000000000v1",
      projectId: SKY,
      purchaseDate: "2026-07-14",
      lineItems: [{ material: "Cement", quantity: 50, unit: "bag", ratePaise: 38000 }],
    });
    expect((await repo.submitPurchaseOrder(draft.id)).status).toBe("SUBMITTED");
    expect((await repo.approvePurchaseOrder(draft.id)).status).toBe("APPROVED");
  });

  it("keeps approved POs immutable (edit throws)", async () => {
    const approved = (await repo.listPurchaseOrders({ status: "APPROVED" }))[0];
    await expect(
      repo.updatePurchaseOrder(approved.id, {
        vendorId: "40000000-0000-0000-0000-0000000000v1",
        projectId: SKY,
        purchaseDate: "2026-07-14",
        lineItems: [{ material: "X", quantity: 1, unit: "nos", ratePaise: 100 }],
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
});

describe("procurement demo — budget integration", () => {
  it("approved POs contribute to project procurement spend", () => {
    localStorage.setItem("constructly.demo.settings.v1", JSON.stringify({ poApprovalRequired: true }));
    // Seed stores by reading once.
    void repo.listPurchaseOrders();
    const spend = demoSpendByProject().get(SKY);
    expect(spend?.procurementPaise ?? 0).toBeGreaterThan(0);
  });
});
