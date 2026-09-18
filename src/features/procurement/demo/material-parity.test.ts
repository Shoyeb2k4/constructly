import { describe, it, expect, beforeEach } from "vitest";
import { demoProcurementRepository as repo } from "./demo-repository";
import { DEMO_VENDORS, demoMaterials, demoVendorMaterials } from "./seed";
import { normalizeMaterialName } from "../material-backfill";
import type { ProcurementRepository } from "../repository";

/**
 * Demo mode is the whole product for anyone evaluating it, and it is the only
 * implementation a reviewer can actually click through. If the material master
 * works on the server but not here, the feature is half-built — so these tests
 * hold the demo to the same behaviour, including the refusals.
 */

const V1 = DEMO_VENDORS[0].id;

beforeEach(() => {
  localStorage.clear();
});

describe("demo material master", () => {
  it("seeds a master derived from the vendors' own material lists", async () => {
    const materials = await repo.listMaterialMaster();
    expect(materials.length).toBeGreaterThan(0);

    // Every legacy vendor string resolves to exactly one seeded material.
    const byNorm = new Map(materials.map((m) => [normalizeMaterialName(m.name), m]));
    for (const v of DEMO_VENDORS) {
      for (const raw of v.materialsSupplied) {
        expect(byNorm.get(normalizeMaterialName(raw)), `${raw} has no master row`).toBeTruthy();
      }
    }
  });

  it("gives the seeded materials real categories and units", async () => {
    const materials = await repo.listMaterialMaster();
    const cement = materials.find((m) => m.name === "Cement")!;
    expect(cement.category).toBe("Cement");
    expect(cement.defaultUnit).toBe("bag");
  });

  it("creates, reads back and renames a material", async () => {
    const created = await repo.createMaterial({ name: "  Tiles ", category: "Tiles", defaultUnit: "sqft" });
    expect(created.name).toBe("Tiles");
    expect(created.isActive).toBe(true);

    await repo.updateMaterial(created.id, { name: "Vitrified Tiles" });
    expect((await repo.getMaterial(created.id))!.name).toBe("Vitrified Tiles");
  });

  it("refuses a duplicate active name case-insensitively, as the server does", async () => {
    await repo.createMaterial({ name: "Tiles" });
    await expect(repo.createMaterial({ name: "tiles" })).rejects.toThrow("MATERIAL_NAME_TAKEN");
  });

  it("refuses a unit outside the canonical list", async () => {
    await expect(repo.createMaterial({ name: "Gravel", defaultUnit: "truckload" })).rejects.toThrow(
      "INVALID_UNIT",
    );
  });

  it("archives and restores rather than deleting", async () => {
    const m = await repo.createMaterial({ name: "Scaffolding" });

    const archived = await repo.setMaterialArchived(m.id, true);
    expect(archived.isActive).toBe(false);
    // Gone from the default list, still resolvable by id.
    expect((await repo.listMaterialMaster()).some((x) => x.id === m.id)).toBe(false);
    expect((await repo.getMaterial(m.id))!.isActive).toBe(false);
    expect((await repo.listMaterialMaster({ includeArchived: true })).some((x) => x.id === m.id)).toBe(true);

    expect((await repo.setMaterialArchived(m.id, false)).isActive).toBe(true);
    expect((await repo.listMaterialMaster()).some((x) => x.id === m.id)).toBe(true);
  });

  it("filters by search and category", async () => {
    expect((await repo.listMaterialMaster({ search: "cem" })).map((m) => m.name)).toContain("Cement");
    const steel = await repo.listMaterialMaster({ category: "Steel" });
    expect(steel.length).toBeGreaterThan(0);
    expect(steel.every((m) => m.category === "Steel")).toBe(true);
  });
});

describe("demo vendor material links", () => {
  it("seeds each vendor with the materials its legacy array named", async () => {
    const links = await repo.listVendorMaterials(V1);
    expect(links.map((m) => m.name).sort()).toEqual([...DEMO_VENDORS[0].materialsSupplied].sort());
  });

  it("replaces the set, and can clear it", async () => {
    const [a, b] = await repo.listMaterialMaster();
    const after = await repo.setVendorMaterials(V1, [a.id, b.id]);
    expect(after.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());

    expect(await repo.setVendorMaterials(V1, [])).toEqual([]);
  });

  it("is idempotent when adding a link that already exists", async () => {
    const [a] = await repo.listMaterialMaster();
    await repo.setVendorMaterials(V1, [a.id]);
    const first = await repo.addMaterialToVendor(V1, a.id);
    const second = await repo.addMaterialToVendor(V1, a.id);
    expect(second).toEqual(first);
    expect(second.filter((m) => m.id === a.id)).toHaveLength(1);
  });

  it("rejects an unknown vendor and an unknown material the same way", async () => {
    const [a] = await repo.listMaterialMaster();
    await expect(repo.listVendorMaterials("no-such-vendor")).rejects.toThrow("NOT_FOUND");
    await expect(repo.setVendorMaterials("no-such-vendor", [a.id])).rejects.toThrow("NOT_FOUND");
    await expect(repo.setVendorMaterials(V1, ["no-such-material"])).rejects.toThrow("NOT_FOUND");
  });

  it("will not link a deactivated material", async () => {
    const m = await repo.createMaterial({ name: "Retired Item" });
    await repo.setMaterialArchived(m.id, true);
    await expect(repo.setVendorMaterials(V1, [m.id])).rejects.toThrow("MATERIAL_ARCHIVED");
    await expect(repo.addMaterialToVendor(V1, m.id)).rejects.toThrow("MATERIAL_ARCHIVED");
  });

  it("stores no quantity — the links are eligibility, nothing more", () => {
    for (const link of demoVendorMaterials()) {
      expect(Object.keys(link).sort()).toEqual(["materialId", "vendorId"]);
    }
  });

  it("unlinking a material leaves the material itself and every PO untouched", async () => {
    const [a] = await repo.listMaterialMaster();
    const posBefore = await repo.listPurchaseOrders();

    await repo.setVendorMaterials(V1, []);

    expect(await repo.getMaterial(a.id)).toBeTruthy();
    const posAfter = await repo.listPurchaseOrders();
    expect(posAfter).toEqual(posBefore);
  });
});

describe("demo purchase orders carry materialId", () => {
  it("seeded lines reference the master where their text matches it", async () => {
    const pos = await repo.listPurchaseOrders();
    const details = await Promise.all(pos.map((p) => repo.getPurchaseOrder(p.id)));
    const lines = details.flatMap((d) => d!.lineItems);

    // Some seeded lines match a master entry exactly ("River Sand",
    // "AAC Blocks") and carry an id; others are more specific than the
    // catalogue ("OPC 53 Cement" vs "Cement") and stay free text. Both shapes
    // are present on purpose — that is what real pre-master history looks like.
    expect(lines.some((l) => l.materialId !== null)).toBe(true);
    expect(lines.some((l) => l.materialId === null)).toBe(true);

    const materials = await repo.listMaterialMaster();
    const byId = new Map(materials.map((m) => [m.id, m]));
    for (const l of lines) {
      if (l.materialId) expect(byId.get(l.materialId)!.name).toBe(l.material);
    }
  });

  it("persists a materialId and snapshots the master name over client text", async () => {
    const material = (await repo.listMaterialMaster())[0];
    const pos = await repo.listPurchaseOrders();
    const sample = (await repo.getPurchaseOrder(pos[0].id))!;

    const created = await repo.createPurchaseOrder({
      vendorId: sample.vendor.id,
      projectId: sample.project.id,
      purchaseDate: "2026-02-01",
      lineItems: [
        {
          material: "HACKED NAME",
          materialId: material.id,
          quantity: 5,
          unit: "bag",
          ratePaise: 40_000,
          gstRateBps: 1800,
        },
      ],
    });

    expect(created.lineItems[0].materialId).toBe(material.id);
    expect(created.lineItems[0].material).toBe(material.name);
  });

  it("keeps a legacy free-text line working, with a null id", async () => {
    const pos = await repo.listPurchaseOrders();
    const sample = (await repo.getPurchaseOrder(pos[0].id))!;
    const created = await repo.createPurchaseOrder({
      vendorId: sample.vendor.id,
      projectId: sample.project.id,
      purchaseDate: "2026-02-01",
      lineItems: [
        { material: "Something bespoke", quantity: 1, unit: "nos", ratePaise: 100, gstRateBps: 0 },
      ],
    });
    expect(created.lineItems[0].materialId).toBeNull();
    expect(created.lineItems[0].material).toBe("Something bespoke");
  });

  it("round-trips materialId through an edit, which rebuilds every line", async () => {
    const material = (await repo.listMaterialMaster())[0];
    const pos = await repo.listPurchaseOrders();
    const sample = (await repo.getPurchaseOrder(pos.find((p) => p.status === "DRAFT")!.id))!;

    const input = {
      vendorId: sample.vendor.id,
      projectId: sample.project.id,
      purchaseDate: sample.purchaseDate,
      lineItems: [
        { material: "x", materialId: material.id, quantity: 2, unit: "bag", ratePaise: 1000, gstRateBps: 0 },
      ],
    };
    const updated = await repo.updatePurchaseOrder(sample.id, input);
    expect(updated.lineItems[0].materialId).toBe(material.id);
  });

  it("refuses a new order naming a deactivated material", async () => {
    const m = await repo.createMaterial({ name: "Retired Item" });
    await repo.setMaterialArchived(m.id, true);
    const pos = await repo.listPurchaseOrders();
    const sample = (await repo.getPurchaseOrder(pos[0].id))!;

    await expect(
      repo.createPurchaseOrder({
        vendorId: sample.vendor.id,
        projectId: sample.project.id,
        purchaseDate: "2026-02-01",
        lineItems: [
          { material: "x", materialId: m.id, quantity: 1, unit: "nos", ratePaise: 1, gstRateBps: 0 },
        ],
      }),
    ).rejects.toThrow("MATERIAL_ARCHIVED");
  });

  it("does not require a vendor mapping to order a material", async () => {
    const m = await repo.createMaterial({ name: "Unmapped Item" });
    const pos = await repo.listPurchaseOrders();
    const sample = (await repo.getPurchaseOrder(pos[0].id))!;
    await repo.setVendorMaterials(sample.vendor.id, []); // vendor supplies nothing

    const created = await repo.createPurchaseOrder({
      vendorId: sample.vendor.id,
      projectId: sample.project.id,
      purchaseDate: "2026-02-01",
      lineItems: [
        { material: "x", materialId: m.id, quantity: 1, unit: "nos", ratePaise: 1, gstRateBps: 0 },
      ],
    });
    expect(created.lineItems[0].materialId).toBe(m.id);
  });
});

describe("legacy demo data keeps working", () => {
  it("a stored PO line with no materialId reads back as null, not undefined", async () => {
    // Exactly what sits in a returning demo user's localStorage from before the
    // master existed. Nothing migrates it; the mapper normalises on read.
    const pos = await repo.listPurchaseOrders();
    const one = (await repo.getPurchaseOrder(pos[0].id))!;
    const legacy = JSON.parse(localStorage.getItem("constructly.demo.pos.v2")!);
    for (const p of legacy) for (const l of p.lineItems) delete l.materialId;
    localStorage.setItem("constructly.demo.pos.v2", JSON.stringify(legacy));

    const after = (await repo.getPurchaseOrder(one.id))!;
    expect(after.lineItems.every((l) => l.materialId === null)).toBe(true);
  });

  it("the legacy array is untouched until the vendor's mapping changes", async () => {
    const vendors = await repo.listVendors();
    const v1 = vendors.find((v) => v.id === V1)!;
    expect(v1.materialsSupplied).toEqual(DEMO_VENDORS[0].materialsSupplied);
  });

  it("once the mapping changes, the legacy array MIRRORS it (Pass 5 transition)", async () => {
    // Pass 3 left this column alone. Pass 5 moves the vendor screens onto
    // VendorMaterial, and the list filter + search still match this column —
    // so it is now written FROM the mapping, or those would go stale.
    const [a, b] = await repo.listMaterialMaster();
    await repo.setVendorMaterials(V1, [a.id, b.id]);
    const after = (await repo.listVendors()).find((v) => v.id === V1)!;
    expect(after.materialsSupplied).toEqual([a.name, b.name].sort((x, y) => x.localeCompare(y)));

    await repo.setVendorMaterials(V1, []);
    const cleared = (await repo.listVendors()).find((v) => v.id === V1)!;
    expect(cleared.materialsSupplied).toEqual([]);
  });
});

describe("contract parity across implementations", () => {
  it("the demo implements every method the interface declares", () => {
    // The HTTP and server repositories are checked by the compiler via their
    // `: ProcurementRepository` annotations; this catches a demo method that is
    // declared but left undefined at runtime.
    const required: (keyof ProcurementRepository)[] = [
      "listMaterialMaster",
      "getMaterial",
      "createMaterial",
      "updateMaterial",
      "setMaterialArchived",
      "listVendorMaterials",
      "setVendorMaterials",
      "addMaterialToVendor",
      "listMaterials",
      "listUnlinkedMaterialNames",
    ];
    for (const key of required) expect(typeof repo[key], key).toBe("function");
  });

  it("seeded materials and links are internally consistent", () => {
    const ids = new Set(demoMaterials().map((m) => m.id));
    const vendorIds = new Set(DEMO_VENDORS.map((v) => v.id));
    for (const l of demoVendorMaterials()) {
      expect(ids.has(l.materialId)).toBe(true);
      expect(vendorIds.has(l.vendorId)).toBe(true);
    }
  });
});
