import { describe, it, expect } from "vitest";
import {
  caseRank,
  displayMaterialName,
  normalizeMaterialName,
  pickDisplayName,
  planMaterialBackfill,
  type VendorMaterialsRow,
} from "./material-backfill";

/**
 * The backfill turns years of free-typed vendor material strings into a master
 * exactly once, against live data, inside a migration that cannot be re-run
 * selectively. These fixtures are the only place that judgement gets to be
 * checked before it runs.
 */

const A = "company-a";
const B = "company-b";

function vendor(id: string, companyId: string, materialsSupplied: string[]): VendorMaterialsRow {
  return { id, companyId, materialsSupplied };
}

describe("material name normalization", () => {
  it("collapses case, surrounding whitespace, and internal whitespace runs", () => {
    const variants = ["Cement", "cement", "CEMENT", "  Cement  ", "\tCement\n", "Ce ment"];
    // The first five are the same material; the sixth is NOT (a space inside a
    // word makes a different string, and we never guess).
    const keys = variants.map(normalizeMaterialName);
    expect(new Set(keys.slice(0, 5)).size).toBe(1);
    expect(keys[5]).toBe("ce ment");
  });

  it("treats a doubled internal space as the same material", () => {
    expect(normalizeMaterialName("TMT  Steel")).toBe(normalizeMaterialName("TMT Steel"));
  });

  it("keeps the display form's case while still trimming it", () => {
    expect(displayMaterialName("  OPC   Cement ")).toBe("OPC Cement");
  });

  it("ranks mixed case above ALL UPPER above all lower", () => {
    expect(caseRank("Cement")).toBe(0);
    expect(caseRank("OPC Cement")).toBe(0);
    expect(caseRank("CEMENT")).toBe(1);
    expect(caseRank("cement")).toBe(2);
  });
});

describe("display spelling selection", () => {
  it("prefers a properly cased spelling over a more frequent sloppy one", () => {
    expect(pickDisplayName(["cement", "cement", "cement", "Cement"])).toBe("Cement");
  });

  it("falls back to the most used spelling when case quality ties", () => {
    expect(pickDisplayName(["Opc Cement", "OPC Cement", "OPC Cement"])).toBe("OPC Cement");
  });

  it("is deterministic, not input-order dependent, on a full tie", () => {
    expect(pickDisplayName(["Bricks", "Blocks"])).toBe(pickDisplayName(["Blocks", "Bricks"]));
  });
});

describe("backfill plan — collapsing duplicates", () => {
  it("collapses casing and whitespace duplicates into ONE material", () => {
    const plan = planMaterialBackfill([
      vendor("v1", A, ["Cement"]),
      vendor("v2", A, ["cement"]),
      vendor("v3", A, ["CEMENT"]),
      vendor("v4", A, ["  Cement  "]),
    ]);

    expect(plan.materials).toHaveLength(1);
    expect(plan.materials[0]).toMatchObject({ companyId: A, name: "Cement", normalizedName: "cement" });
    // All four vendors end up mapped to it.
    expect(plan.links).toHaveLength(4);
    expect(plan.links.every((l) => l.normalizedName === "cement")).toBe(true);
  });

  it("does NOT merge Cement and OPC Cement — no fuzzy matching", () => {
    const plan = planMaterialBackfill([vendor("v1", A, ["Cement", "OPC Cement"])]);

    expect(plan.materials.map((m) => m.name).sort()).toEqual(["Cement", "OPC Cement"]);
    expect(plan.links).toHaveLength(2);
  });

  it("keeps semantically close but textually distinct names apart", () => {
    const plan = planMaterialBackfill([
      vendor("v1", A, ["TMT Steel", "TMT Steel 12mm", "Structural Steel", "Steel"]),
    ]);
    expect(plan.materials).toHaveLength(4);
  });

  it("drops blank and whitespace-only entries", () => {
    const plan = planMaterialBackfill([vendor("v1", A, ["", "   ", "\t\n", "Sand"])]);
    expect(plan.materials.map((m) => m.name)).toEqual(["Sand"]);
    expect(plan.links).toHaveLength(1);
  });

  it("tolerates a vendor with no materials at all", () => {
    const plan = planMaterialBackfill([vendor("v1", A, []), vendor("v2", A, ["Sand"])]);
    expect(plan.materials).toHaveLength(1);
    expect(plan.links).toEqual([{ companyId: A, vendorId: "v2", normalizedName: "sand" }]);
  });
});

describe("backfill plan — vendor mappings", () => {
  it("creates one mapping per vendor per material, from the existing arrays", () => {
    const plan = planMaterialBackfill([
      vendor("v1", A, ["Cement", "Sand"]),
      vendor("v2", A, ["Sand", "TMT Steel"]),
    ]);

    expect(plan.materials.map((m) => m.name).sort()).toEqual(["Cement", "Sand", "TMT Steel"]);
    expect(
      plan.links.map((l) => `${l.vendorId}:${l.normalizedName}`).sort(),
    ).toEqual(["v1:cement", "v1:sand", "v2:sand", "v2:tmt steel"]);
  });

  it("never emits a duplicate mapping when one vendor lists the same material twice", () => {
    const plan = planMaterialBackfill([vendor("v1", A, ["Cement", "cement", "  CEMENT"])]);
    expect(plan.materials).toHaveLength(1);
    expect(plan.links).toHaveLength(1);
  });
});

describe("backfill plan — tenant separation", () => {
  it("gives each company its OWN Cement — never a shared row", () => {
    const plan = planMaterialBackfill([vendor("v1", A, ["Cement"]), vendor("v9", B, ["Cement"])]);

    expect(plan.materials).toHaveLength(2);
    expect(plan.materials.map((m) => m.companyId).sort()).toEqual([A, B]);
  });

  it("only ever maps a vendor to a material planned for that vendor's company", () => {
    const plan = planMaterialBackfill([
      vendor("v1", A, ["Cement", "Sand"]),
      vendor("v9", B, ["Cement"]),
    ]);

    for (const link of plan.links) {
      const owner = plan.materials.find(
        (m) => m.normalizedName === link.normalizedName && m.companyId === link.companyId,
      );
      expect(owner, `no same-company material for ${link.vendorId}/${link.normalizedName}`).toBeDefined();
    }
  });
});
