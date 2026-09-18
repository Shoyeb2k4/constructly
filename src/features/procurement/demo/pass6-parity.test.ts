import { describe, it, expect, beforeEach } from "vitest";
import { demoProcurementRepository as repo } from "./demo-repository";

/**
 * Demo mode must behave like the server for Pass 6: an older app's vendor
 * materials reconcile by the same rule, a duplicate drops an archived
 * material's id, and a material rename keeps vendor mirrors current.
 */

beforeEach(() => {
  localStorage.clear();
});

async function vendorNamed(name: string) {
  return (await repo.listVendors()).find((v) => v.businessName === name)!;
}

describe("older-app vendor saves (Gate 0) in demo mode", () => {
  it("a name that exists in the master becomes a mapping", async () => {
    const v = await vendorNamed("UltraTech Cement"); // Cement, Concrete, AAC Blocks
    await repo.updateVendor(v.id, {
      materialsSupplied: [...v.materialsSupplied, "TMT Steel"],
    });
    const after = await vendorNamed("UltraTech Cement");
    expect(after.materials.map((m) => m.name)).toContain("TMT Steel");
  });

  it("an unmatched name is kept as text, shown as unlinked, and no material is created", async () => {
    const before = (await repo.listMaterialMaster({ includeArchived: true })).length;
    const v = await vendorNamed("UltraTech Cement");
    await repo.updateVendor(v.id, { materialsSupplied: [...v.materialsSupplied, "Waterproofing Chemical"] });

    const after = await vendorNamed("UltraTech Cement");
    expect(after.materialsSupplied).toContain("Waterproofing Chemical");
    expect(after.unlinkedMaterialNames).toEqual(["Waterproofing Chemical"]);
    expect((await repo.listMaterialMaster({ includeArchived: true })).length).toBe(before);
  });

  it("a later save from the new UI keeps that text instead of silently dropping it", async () => {
    const v = await vendorNamed("UltraTech Cement");
    await repo.updateVendor(v.id, { materialsSupplied: [...v.materialsSupplied, "Waterproofing Chemical"] });
    const ids = (await vendorNamed("UltraTech Cement")).materials.map((m) => m.id);
    await repo.updateVendor(v.id, { materialIds: ids });
    expect((await vendorNamed("UltraTech Cement")).unlinkedMaterialNames).toEqual(["Waterproofing Chemical"]);
  });

  it("renaming a material refreshes the mirror of every vendor mapped to it", async () => {
    const cement = (await repo.listMaterialMaster()).find((m) => m.name === "Cement")!;
    await repo.updateMaterial(cement.id, { name: "OPC 53 Cement" });
    const v = await vendorNamed("UltraTech Cement");
    expect(v.materialsSupplied).toContain("OPC 53 Cement");
    expect(v.materialsSupplied).not.toContain("Cement");
    // So nothing is misreported as legacy-only text.
    expect(v.unlinkedMaterialNames).toEqual([]);
  });
});

describe("duplicating an order in demo mode", () => {
  async function orderWith(materialName: string) {
    const v = await vendorNamed("UltraTech Cement");
    const m = (await repo.listMaterialMaster()).find((x) => x.name === materialName)!;
    const seed = (await repo.listPurchaseOrders())[0];
    const project = (await repo.getPurchaseOrder(seed.id))!.project;
    const po = await repo.createPurchaseOrder({
      vendorId: v.id,
      projectId: project.id,
      purchaseDate: "2026-03-01",
      lineItems: [{ material: "x", materialId: m.id, quantity: 1, unit: "bag", ratePaise: 1, gstRateBps: 0 }],
    });
    return { po, m };
  }

  it("keeps an active material's id", async () => {
    const { po, m } = await orderWith("Cement");
    const copy = await repo.duplicatePurchaseOrder(po.id);
    expect(copy.lineItems[0].materialId).toBe(m.id);
  });

  it("drops an archived material's id but keeps the line's name", async () => {
    const { po, m } = await orderWith("Concrete");
    await repo.setMaterialArchived(m.id, true);
    const copy = await repo.duplicatePurchaseOrder(po.id);
    expect(copy.lineItems[0].materialId).toBeNull();
    expect(copy.lineItems[0].material).toBe("Concrete");
  });

  it("a revise keeps it — the same order, not a new one", async () => {
    const { po, m } = await orderWith("Concrete");
    await repo.setMaterialArchived(m.id, true);
    const rev = await repo.revisePurchaseOrder(po.id);
    expect(rev.lineItems[0].materialId).toBe(m.id);
  });
});
