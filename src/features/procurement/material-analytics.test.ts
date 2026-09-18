import { describe, it, expect } from "vitest";
import {
  legacyMaterialKey,
  materialBucketOf,
  materialFilterIntent,
  materialIndex,
  matchesRecordedName,
  unlinkedRecordedNames,
} from "./material-identity";
import { projectVendorRollups, vendorProjectRollups, type POForRollup } from "./calc";
import { distinctMaterialLabels } from "./material-identity";
import { assembleDashboard } from "@/features/dashboard/assemble";
import type { RawDashboardData, RawProcurementLine, RawProcurementPO } from "@/features/dashboard/types";

/**
 * Pass 7 — analytics identity. Linked lines group by materialId; unlinked lines
 * by `legacy:<normalized snapshot>`; nothing is ever grouped by a current or
 * display NAME, and no unlinked line is guessed into a Material.
 */

const M1 = "m1-cement";
const M2 = "m2-cement-other";
const MASTER = [
  // M1 was created as "Cement" and has since been renamed.
  { id: M1, name: "OPC 53 Grade Cement", archived: false },
  // A DIFFERENT material that happens to share a display name with a snapshot.
  { id: M2, name: "Cement", archived: false },
  { id: "m3-primer", name: "Primer", archived: true },
];

/* ── Dashboard top materials, through the real assembler ─────────────── */

function po(id: string, lines: RawProcurementLine[], over: Partial<RawProcurementPO> = {}): RawProcurementPO {
  return {
    id,
    poNumber: id,
    vendorId: "v1",
    vendorName: "Vendor",
    projectId: "p1",
    projectName: "P",
    projectCode: "PRJ-1",
    status: "APPROVED",
    purchaseDate: "2026-07-01",
    expectedDelivery: null,
    gstPaise: 0,
    totalPaise: lines.reduce((s, l) => s + l.amountPaise, 0),
    paidPaise: 0,
    createdAt: "2026-07-01T00:00:00Z",
    lines,
    ...over,
  };
}
function top(pos: RawProcurementPO[], materials = MASTER) {
  const raw: RawDashboardData = {
    projects: [],
    spendEntries: [],
    labourEntries: [],
    pendingPOs: [],
    procurementPOs: pos,
    procurementMaterials: materials,
    procurementPayments: [],
    approvalRequired: false,
    activity: [],
    today: "2026-07-15",
  };
  return assembleDashboard(raw).procurement.topMaterials;
}
const line = (material: string, amountPaise: number, materialId: string | null = null): RawProcurementLine => ({
  material,
  materialId,
  category: null,
  amountPaise,
});

describe("dashboard top materials — identity, not names", () => {
  it("14. canonical lines group by Material ID", () => {
    const rows = top([po("a", [line("OPC 53 Grade Cement", 100_000, M1)]), po("b", [line("OPC 53 Grade Cement", 200_000, M1)])]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: M1, materialId: M1, linked: true, amountPaise: 300_000 });
  });

  it("15. a renamed Material stays ONE bucket, labelled by its current name", () => {
    // Old snapshot "Cement" (before the rename), new snapshot after it.
    const rows = top([po("a", [line("Cement", 100_000, M1)]), po("b", [line("OPC 53 Grade Cement", 200_000, M1)])]);
    const m1 = rows.filter((r) => r.materialId === M1);
    expect(m1).toHaveLength(1);
    expect(m1[0]).toMatchObject({ material: "OPC 53 Grade Cement", amountPaise: 300_000 });
  });

  it("16. the same display name on different Material IDs stays separate", () => {
    // Snapshot "Cement" linked to M1 (pre-rename) and to M2 (named Cement).
    const rows = top([po("a", [line("Cement", 100_000, M1)]), po("b", [line("Cement", 50_000, M2)])]);
    expect(rows.map((r) => r.key).sort()).toEqual([M1, M2].sort());
  });

  it("17. unlinked case/whitespace variants collapse into one legacy bucket", () => {
    const rows = top([po("a", [line("Cement", 1, null), line("  CEMENT ", 2, null), line("cement", 4, null)])]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "legacy:cement", linked: false, amountPaise: 7 });
  });

  it("18. unlinked 'Cement' and 'OPC Cement' stay different — no fuzzy matching", () => {
    const rows = top([po("a", [line("Cement", 1), line("OPC Cement", 2)])]);
    expect(rows.map((r) => r.key).sort()).toEqual(["legacy:cement", "legacy:opc cement"]);
  });

  it("19/21. an unlinked name is never guessed into a Material — even an exact, unique name match", () => {
    // M2 is the ONLY material named "Cement", yet unlinked "Cement" history is
    // not merged into it: name resolution is not stable across renames.
    const rows = top([po("a", [line("Cement", 10, null)]), po("b", [line("Cement", 20, M2)])]);
    expect(rows.find((r) => r.key === M2)?.amountPaise).toBe(20);
    expect(rows.find((r) => r.key === "legacy:cement")?.amountPaise).toBe(10);
    // Both buckets say "Cement"; the flag is what tells them apart on screen.
    expect(rows.find((r) => r.key === "legacy:cement")?.linked).toBe(false);
  });

  it("19b. an ambiguous name (two Materials, e.g. one archived) is certainly not guessed", () => {
    const master = [...MASTER, { id: "m4-old-cement", name: "Cement", archived: true }];
    const rows = top([po("a", [line("Cement", 10, null)])], master);
    expect(rows).toEqual([expect.objectContaining({ key: "legacy:cement", materialId: null })]);
  });

  it("20. an archived Material keeps its historical spend, flagged archived", () => {
    const rows = top([po("a", [line("Primer", 500, "m3-primer")])]);
    expect(rows[0]).toMatchObject({ key: "m3-primer", archived: true, linked: true, amountPaise: 500 });
  });

  it("hard-deleted Material (FK set null) falls back safely to its snapshot's legacy bucket", () => {
    const rows = top([po("a", [line("Retired Thing", 9, null)])], []);
    expect(rows[0]).toMatchObject({ key: "legacy:retired thing", materialId: null, linked: false, material: "Retired Thing" });
  });

  it("a linked id missing from the index still groups by id (label falls back to the snapshot)", () => {
    const rows = top([po("a", [line("Ghost", 1, "m-missing")]), po("b", [line("Ghost v2", 2, "m-missing")])], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "m-missing", amountPaise: 3 });
  });

  it("22. spend totals equal the source line amounts exactly — nothing lost or double-counted", () => {
    const pos = [
      po("a", [line("Cement", 123_457, M1), line("Cement", 99, null), line("Primer", 1, "m3-primer")]),
      po("b", [line("OPC 53 Grade Cement", 876_543, M1), line("cement ", 1, null)]),
    ];
    const rows = top(pos);
    const source = pos.flatMap((p) => p.lines).reduce((s, l) => s + l.amountPaise, 0);
    expect(rows.reduce((s, r) => s + r.amountPaise, 0)).toBe(source);
    expect(rows.find((r) => r.key === M1)?.amountPaise).toBe(1_000_000);
  });

  it("23. money only: quantities are never merged across units (none are carried at all)", () => {
    // 10 bags and 2 tonnes of the same Material: the ₹ sum is meaningful, a
    // quantity sum would not be — so the rollup has no quantity to get wrong.
    const rows = top([po("a", [line("Cement", 4_000, M1)]), po("b", [line("Cement", 16_000, M1)])]);
    expect(rows[0].amountPaise).toBe(20_000);
    expect(Object.keys(rows[0])).not.toContain("quantity");
  });

  it("25. no .toLowerCase() name identity: a linked line never shares a bucket with same-text history", () => {
    const rows = top([po("a", [line("cement", 5, null)]), po("b", [line("Cement", 7, M2)])]);
    expect(rows).toHaveLength(2);
  });
});

/* ── Procurement vendor ⇄ project rollups ─────────────────────────────── */

describe("24. vendor/project rollups use canonical identity", () => {
  const index = materialIndex(MASTER);
  const rollupPO = (id: string, vendorId: string, projectId: string, lines: { material: string; materialId: string | null }[]): POForRollup => ({
    id,
    vendorId,
    projectId,
    status: "APPROVED",
    totalPaise: 100,
    purchaseDate: "2026-07-01",
    materials: distinctMaterialLabels(lines, index),
  });

  it("a renamed material lists once under its current name; money is unchanged", () => {
    const pos = [
      rollupPO("a", "v1", "p1", [{ material: "Cement", materialId: M1 }]),
      rollupPO("b", "v1", "p1", [{ material: "OPC 53 Grade Cement", materialId: M1 }]),
    ];
    const [r] = vendorProjectRollups(pos, [], "v1", false);
    expect(r.materials).toEqual(["OPC 53 Grade Cement"]);
    expect(r.purchaseValuePaise).toBe(200);
  });

  it("two Materials that read the same, and same-text unlinked history, are listed separately", () => {
    const pos = [
      rollupPO("a", "v1", "p1", [{ material: "Cement", materialId: M2 }]),
      rollupPO("b", "v2", "p1", [{ material: "Cement", materialId: null }, { material: "CEMENT", materialId: null }]),
    ];
    const rows = projectVendorRollups(pos, [], "p1", false);
    expect(rows.find((r) => r.id === "v1")?.materials).toEqual(["Cement"]);
    // v2's two unlinked spellings are ONE legacy identity.
    expect(rows.find((r) => r.id === "v2")?.materials).toEqual(["Cement"]);
    const merged = projectVendorRollups(
      [rollupPO("c", "v3", "p1", [{ material: "Cement", materialId: M2 }, { material: "Cement", materialId: null }])],
      [],
      "p1",
      false,
    );
    // Same vendor, same label, two identities: both survive.
    expect(merged[0].materials).toEqual(["Cement", "Cement"]);
  });
});

/* ── Pure rule pieces ─────────────────────────────────────────────────── */

describe("identity rule pieces", () => {
  it("legacy key normalization is exactly trim + collapse whitespace + case-fold", () => {
    expect(legacyMaterialKey("  OPC   53  Cement ")).toBe("legacy:opc 53 cement");
    expect(legacyMaterialKey("TMT-Steel")).not.toBe(legacyMaterialKey("TMT Steel"));
  });

  it("a linked line's bucket never depends on its snapshot text", () => {
    const idx = materialIndex(MASTER);
    expect(materialBucketOf({ material: "anything", materialId: M1 }, idx).key).toBe(M1);
    expect(materialBucketOf({ material: "Cement", materialId: M1 }, idx).key).not.toBe(
      materialBucketOf({ material: "Cement", materialId: M2 }, idx).key,
    );
  });

  it("recorded-name matching is normalized-exact, never contains/fuzzy", () => {
    expect(matchesRecordedName("  cement ", "Cement")).toBe(true);
    expect(matchesRecordedName("OPC Cement", "Cement")).toBe(false);
    expect(matchesRecordedName("Cement", "   ")).toBe(false);
  });

  it("filter intent: materialId wins; blank/ALL means no constraint", () => {
    expect(materialFilterIntent({ materialId: M1, material: "Cement" })).toEqual({ kind: "id", materialId: M1 });
    expect(materialFilterIntent({ material: "Cement" })).toEqual({ kind: "name", name: "Cement" });
    expect(materialFilterIntent({ materialId: "ALL", material: " " })).toBeNull();
    expect(materialFilterIntent({})).toBeNull();
  });

  it("unlinked recorded names: one per normalized key, best spelling, linked lines excluded", () => {
    expect(
      unlinkedRecordedNames([
        { material: "cement", materialId: null },
        { material: "CEMENT", materialId: null },
        { material: "Cement ", materialId: null },
        { material: "Linked Only", materialId: M1 },
        { material: "wall putty", materialId: null },
      ]),
    ).toEqual(["Cement", "wall putty"]);
  });
});
