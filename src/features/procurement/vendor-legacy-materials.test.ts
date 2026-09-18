import { describe, it, expect } from "vitest";
import {
  buildMirror,
  planLegacyVendorMaterials,
  unlinkedLegacyNames,
  type MasterMaterialRef,
} from "./vendor-legacy-materials";

/**
 * Older mobile builds send a vendor's materials only as free text, in full, on
 * every save. These fixtures pin the one thing that must never happen — an old
 * app quietly desynchronising the canonical mappings — and the things that must
 * never happen in fixing it: guessing, minting materials, or losing text.
 */

const m = (id: string, name: string, isActive = true): MasterMaterialRef => ({ id, name, isActive });

const CEMENT = m("m-cement", "Cement");
const OPC = m("m-opc", "OPC Cement");
const SAND = m("m-sand", "Sand");
const STEEL = m("m-steel", "TMT Steel");
const MASTER = [CEMENT, OPC, SAND, STEEL];

function plan(args: {
  submitted: string[];
  previousColumn?: string[];
  current?: MasterMaterialRef[];
  master?: MasterMaterialRef[];
}) {
  return planLegacyVendorMaterials({
    submitted: args.submitted,
    previousColumn: args.previousColumn ?? [],
    current: args.current ?? [],
    master: args.master ?? MASTER,
  });
}

describe("the reported split-brain case", () => {
  it("an old app adding Sand cannot leave the canonical mappings on Cement alone", () => {
    // Legacy: ["Cement", "Sand"]. Canonical before: [Cement]. Sand IS in the
    // master — so it must become a mapping, not just text the web UI never shows.
    const p = plan({ submitted: ["Cement", "Sand"], previousColumn: ["Cement"], current: [CEMENT] });
    expect(p.finalIds.sort()).toEqual(["m-cement", "m-sand"]);
    expect(p.added).toEqual(["m-sand"]);
    expect(p.unmatched).toEqual([]);
  });
});

describe("matching is exact, never fuzzy", () => {
  it("matches across case and whitespace, using the migration's normalisation", () => {
    expect(plan({ submitted: ["  CEMENT  "] }).finalIds).toEqual(["m-cement"]);
    expect(plan({ submitted: ["tmt   steel"] }).finalIds).toEqual(["m-steel"]);
  });

  it("never turns 'Cement' into 'OPC Cement', or the reverse", () => {
    expect(plan({ submitted: ["Cement"] }).finalIds).toEqual(["m-cement"]);
    expect(plan({ submitted: ["OPC Cement"] }).finalIds).toEqual(["m-opc"]);
    expect(plan({ submitted: ["OPC"] }).finalIds).toEqual([]);
  });

  it("does not guess between two live materials that normalise the same", () => {
    const ambiguous = [m("a", "TMT Steel"), m("b", "TMT  Steel")];
    const p = plan({ submitted: ["TMT Steel"], master: ambiguous });
    expect(p.finalIds).toEqual([]);
    expect(p.unmatched).toEqual(["TMT Steel"]);
  });
});

describe("free text never becomes a material", () => {
  it("keeps an unmatched name as legacy text, verbatim", () => {
    const p = plan({ submitted: ["Cement", "Waterproofing Chemical"] });
    expect(p.finalIds).toEqual(["m-cement"]);
    expect(p.unmatched).toEqual(["Waterproofing Chemical"]);
    expect(p.mirror).toEqual(["Cement", "Waterproofing Chemical"]);
  });

  it("produces no id that is not already in the master", () => {
    const p = plan({ submitted: ["Anything", "At All", "Cement"] });
    const known = new Set(MASTER.map((x) => x.id));
    expect(p.finalIds.every((id) => known.has(id))).toBe(true);
  });
});

describe("removal only on proof of intent", () => {
  it("an old app's round-trip of what it was shown changes nothing", () => {
    // The ordinary case: someone edits the phone number. The full list comes
    // back unchanged, and so must the mappings.
    const p = plan({
      submitted: ["Cement", "Sand"],
      previousColumn: ["Cement", "Sand"],
      current: [CEMENT, SAND],
    });
    expect(p.added).toEqual([]);
    expect(p.removed).toEqual([]);
  });

  it("removes a mapping the old app was shown and left out", () => {
    const p = plan({
      submitted: ["Cement"],
      previousColumn: ["Cement", "Sand"],
      current: [CEMENT, SAND],
    });
    expect(p.removed).toEqual(["m-sand"]);
    expect(p.finalIds).toEqual(["m-cement"]);
  });

  it("KEEPS a mapping the old app never displayed under its current name", () => {
    // The material was renamed to "OPC Cement" after the app last loaded the
    // vendor; it showed "Cement". Not sending "OPC Cement" back proves nothing.
    const renamed = m("m-cement", "OPC Cement 53");
    const p = plan({
      submitted: ["Cement"],
      previousColumn: ["Cement"],
      current: [renamed],
      master: [renamed],
    });
    expect(p.removed).toEqual([]);
    expect(p.finalIds).toEqual(["m-cement"]);
  });
});

describe("archived materials", () => {
  const OLD = m("m-old", "Retired Cement", false);

  it("an archived material the vendor already has stays mapped", () => {
    const p = plan({
      submitted: ["Retired Cement"],
      previousColumn: ["Retired Cement"],
      current: [OLD],
      master: [OLD],
    });
    expect(p.finalIds).toEqual(["m-old"]);
    expect(p.removed).toEqual([]);
  });

  it("an archived material is never NEWLY mapped — the name stays as text", () => {
    const p = plan({ submitted: ["Retired Cement"], master: [OLD] });
    expect(p.finalIds).toEqual([]);
    expect(p.unmatched).toEqual(["Retired Cement"]);
  });

  it("prefers the vendor's existing mapping over a same-named new material", () => {
    // Names are reusable after archiving. The old app is sending back the name
    // it was shown, which came from the archived mapping — that is not a
    // request to switch to the new material.
    const fresh = m("m-new", "Retired Cement");
    const p = plan({
      submitted: ["Retired Cement"],
      previousColumn: ["Retired Cement"],
      current: [OLD],
      master: [OLD, fresh],
    });
    expect(p.finalIds).toEqual(["m-old"]);
    expect(p.added).toEqual([]);
  });
});

describe("the legacy mirror", () => {
  it("lists canonical names first, then legacy-only text, with no duplicates", () => {
    expect(buildMirror(["Sand", "Cement", "cement"], ["Waterproofing", "SAND"])).toEqual([
      "Cement",
      "Sand",
      "Waterproofing",
    ]);
  });

  it("drops blank entries", () => {
    expect(buildMirror(["Cement"], ["", "   "])).toEqual(["Cement"]);
  });
});

describe("unlinked legacy names", () => {
  it("are the column entries with no canonical mapping behind them", () => {
    expect(unlinkedLegacyNames(["Cement", "sand ", "Waterproofing"], ["Cement", "Sand"])).toEqual([
      "Waterproofing",
    ]);
  });

  it("are empty when the column is simply the mirror", () => {
    expect(unlinkedLegacyNames(["Cement", "Sand"], ["Sand", "Cement"])).toEqual([]);
  });
});
