import { describe, it, expect, beforeEach } from "vitest";
import { demoProcurementRepository as repo } from "./demo-repository";
import { gatherDemoDashboard } from "@/features/dashboard/demo/gather";
import { assembleDashboard } from "@/features/dashboard/assemble";

/**
 * Pass 7 in demo mode: the same identity and fallback rules as the server
 * (material-identity.ts), run against the real demo repository and seed —
 * linked filter, recorded-name filter, rename, archive, vendor filter/search.
 */

beforeEach(() => {
  localStorage.clear();
});

async function material(name: string) {
  return (await repo.listMaterialMaster({ includeArchived: true })).find((m) => m.name === name)!;
}
async function vendor(name: string) {
  return (await repo.listVendors()).find((v) => v.businessName === name)!;
}
async function orderOf(materialName: string, vendorName = "UltraTech Cement") {
  const v = await vendor(vendorName);
  const m = await material(materialName);
  const seed = (await repo.listPurchaseOrders())[0];
  const project = (await repo.getPurchaseOrder(seed.id))!.project;
  const po = await repo.createPurchaseOrder({
    vendorId: v.id,
    projectId: project.id,
    purchaseDate: "2026-03-01",
    lineItems: [{ material: "ignored", materialId: m.id, quantity: 2, unit: "bag", ratePaise: 50_000, gstRateBps: 0 }],
  });
  return { po, m, v, projectId: project.id };
}
const numbers = (rows: { poNumber: string }[]) => rows.map((r) => r.poNumber);

describe("PO list material filter (demo)", () => {
  it("canonical: only POs with a line linked to that Material", async () => {
    const cement = await orderOf("Cement");
    const concrete = await orderOf("Concrete");
    const hits = numbers(await repo.listPurchaseOrders({ materialId: cement.m.id }));
    expect(hits).toContain(cement.po.poNumber);
    expect(hits).not.toContain(concrete.po.poNumber);
    // Seeded unlinked "OPC 53 Cement" history is NOT identity-matched to Cement.
    const legacyCement = (await repo.listPurchaseOrders({ material: "OPC 53 Cement" })).map((p) => p.poNumber);
    expect(legacyCement.length).toBeGreaterThan(0);
    for (const n of legacyCement) expect(hits).not.toContain(n);
  });

  it("recorded-name path: unlinked history stays discoverable, case/space-insensitive", async () => {
    const exact = numbers(await repo.listPurchaseOrders({ material: "OPC 53 Cement" }));
    const loose = numbers(await repo.listPurchaseOrders({ material: "  opc   53 CEMENT " }));
    expect(loose).toEqual(exact);
    expect(exact.length).toBeGreaterThan(0);
    // …and it is an exact name, not a contains: "Cement" alone does not match.
    const bare = numbers(await repo.listPurchaseOrders({ material: "Cement" }));
    for (const n of exact) expect(bare).not.toContain(n);
  });

  it("offers unlinked history names as filter options (linked-only names excluded)", async () => {
    await orderOf("Cement");
    const names = await repo.listUnlinkedMaterialNames();
    expect(names).toEqual(expect.arrayContaining(["OPC 53 Cement", "Emulsion Paint"]));
    expect(names).not.toContain("Cement");
  });

  it("materialId wins over a name; an empty filter constrains nothing", async () => {
    const cement = await orderOf("Cement");
    const both = numbers(await repo.listPurchaseOrders({ materialId: cement.m.id, material: "OPC 53 Cement" }));
    expect(both).toEqual(numbers(await repo.listPurchaseOrders({ materialId: cement.m.id })));
    const all = numbers(await repo.listPurchaseOrders());
    expect(numbers(await repo.listPurchaseOrders({ materialId: "ALL", material: "" }))).toEqual(all);
  });

  it("an archived Material's history is still filterable by its id", async () => {
    const { po, m } = await orderOf("Concrete");
    await repo.setMaterialArchived(m.id, true);
    expect(numbers(await repo.listPurchaseOrders({ materialId: m.id }))).toContain(po.poNumber);
  });
});

describe("21. Material rename — one identity end to end (demo)", () => {
  it("snapshot unchanged, filter/analytics follow the id, vendor mapping keeps the id", async () => {
    const { po, m, v, projectId } = await orderOf("Cement");
    // Counted (approved) orders, so rollups and the dashboard include them.
    await repo.submitPurchaseOrder(po.id);
    await repo.approvePurchaseOrder(po.id);
    await repo.updateMaterial(m.id, { name: "OPC Cement" });

    // The PO document still says what was ordered.
    const detail = (await repo.getPurchaseOrder(po.id))!;
    expect(detail.lineItems[0].material).toBe("Cement");
    expect(detail.lineItems[0].materialId).toBe(m.id);

    // The canonical filter still finds it, and the master shows the new name.
    expect(numbers(await repo.listPurchaseOrders({ materialId: m.id }))).toContain(po.poNumber);
    expect((await material("OPC Cement")).id).toBe(m.id);

    // Search finds it by the current name too.
    expect(numbers(await repo.listPurchaseOrders({ search: "OPC Cement" }))).toContain(po.poNumber);

    // A second order after the rename: still ONE identity in rollups.
    const second = await orderOf("OPC Cement");
    await repo.submitPurchaseOrder(second.po.id);
    await repo.approvePurchaseOrder(second.po.id);
    const proc = await repo.getProjectProcurement(projectId);
    const row = proc.vendors.find((r) => r.id === v.id)!;
    expect(row.materials.filter((x) => x === "OPC Cement")).toHaveLength(1);
    expect(row.materials).not.toContain("Cement");

    // Dashboard: one bucket for the id, labelled by the current name.
    const dash = assembleDashboard(gatherDemoDashboard({ userId: "demo", isOwner: true }));
    const buckets = dash.procurement.topMaterials.filter((r) => r.materialId === m.id);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ key: m.id, material: "OPC Cement", linked: true, amountPaise: 200_000 });

    // The vendor mapping still points at the same id.
    expect((await vendor("UltraTech Cement")).materials.map((x) => x.id)).toContain(m.id);
  });
});

describe("vendor filter and search (demo)", () => {
  it("filters through VendorMaterial, independent of the legacy mirror", async () => {
    const cement = await material("Cement");
    const before = (await repo.listVendors({ materialId: cement.id })).map((v) => v.businessName);
    expect(before).toContain("UltraTech Cement");

    // Corrupt the mirror: drop every name from UltraTech's legacy column, and
    // write "Cement" into a vendor that has NO Cement mapping.
    const KEY = "constructly.demo.vendors.v2";
    const rows = JSON.parse(localStorage.getItem(KEY)!) as { businessName: string; materialsSupplied: string[] }[];
    for (const r of rows) {
      if (r.businessName === "UltraTech Cement") r.materialsSupplied = [];
      if (r.businessName === "Sanghvi Steel") r.materialsSupplied = ["Cement"];
    }
    localStorage.setItem(KEY, JSON.stringify(rows));

    const after = (await repo.listVendors({ materialId: cement.id })).map((v) => v.businessName);
    expect(after).toEqual(before);
    expect(after).not.toContain("Sanghvi Steel");
  });

  it("search matches mapped material names (contains, case-insensitive), like the server", async () => {
    const hits = (await repo.listVendors({ search: "aac bl" })).map((v) => v.businessName);
    expect(hits).toEqual(["UltraTech Cement"]);
  });

  it("an older app's name filter still resolves: mapped by normalized name, or an unmapped legacy name", async () => {
    expect((await repo.listVendors({ material: "  cement " })).map((v) => v.businessName)).toContain("UltraTech Cement");
    const v = await vendor("UltraTech Cement");
    await repo.updateVendor(v.id, { materialsSupplied: [...v.materialsSupplied, "Waterproofing Chemical"] });
    expect((await repo.listVendors({ material: "Waterproofing Chemical" })).map((x) => x.businessName)).toEqual([
      "UltraTech Cement",
    ]);
  });
});
