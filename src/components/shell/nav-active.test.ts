import { describe, it, expect } from "vitest";
import { activeNavHref } from "./sidebar";
import { NAV_ITEMS } from "@/config/nav";

/**
 * Nested nav routes: /procurement/materials sits below /procurement, so a
 * prefix test alone matches BOTH items. Each link used to decide for itself,
 * which would have highlighted two rows and put two `aria-current="page"` in one
 * navigation — a real accessibility defect, not a cosmetic one.
 */

const HREFS = NAV_ITEMS.map((i) => i.href);

describe("activeNavHref", () => {
  it("picks the most specific item when routes nest", () => {
    expect(activeNavHref("/procurement/materials", HREFS)).toBe("/procurement/materials");
  });

  it("still picks the parent for the parent's own pages", () => {
    expect(activeNavHref("/procurement", HREFS)).toBe("/procurement");
    // A purchase order detail page belongs to Procurement, not Materials.
    expect(activeNavHref("/procurement/po-123", HREFS)).toBe("/procurement");
  });

  it("matches a child route of the more specific item too", () => {
    expect(activeNavHref("/procurement/materials/anything", HREFS)).toBe("/procurement/materials");
  });

  it("returns exactly one active href for every nav destination", () => {
    for (const href of HREFS) {
      const matches = HREFS.filter((h) => activeNavHref(href, HREFS) === h);
      expect(matches, `${href} should resolve to a single item`).toHaveLength(1);
    }
  });

  it("leaves unrelated paths with no active item", () => {
    expect(activeNavHref("/dashboard", ["/projects", "/vendors"])).toBeNull();
  });

  it("does not treat a shared prefix as a match", () => {
    // "/procurement-archive" must not activate "/procurement".
    expect(activeNavHref("/procurement-archive", ["/procurement"])).toBeNull();
  });
});

describe("the Materials nav entry", () => {
  const materials = NAV_ITEMS.find((i) => i.href === "/procurement/materials");

  it("exists and is gated on the materials module", () => {
    expect(materials).toBeTruthy();
    expect(materials!.label).toBe("Materials");
    expect(materials!.modules).toEqual(["materials"]);
  });

  it("sits beside Vendors, as procurement master data", () => {
    const order = NAV_ITEMS.map((i) => i.label);
    expect(order.indexOf("Materials")).toBe(order.indexOf("Vendors") + 1);
  });
});
