import { describe, it, expect } from "vitest";
import { relativeLuminance, contrastRatio, contrastOnWhite, MIN_CONTRAST } from "./contrast";
import { darkenHex } from "./assets";

describe("relativeLuminance", () => {
  it("black is 0, white is 1", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });
});

describe("contrastRatio", () => {
  it("black on white is ~21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });
  it("identical colors are 1:1", () => {
    expect(contrastRatio("#2e5bff", "#2e5bff")).toBeCloseTo(1, 5);
  });
  it("is symmetric", () => {
    expect(contrastRatio("#123456", "#abcdef")).toBeCloseTo(contrastRatio("#abcdef", "#123456"), 6);
  });
});

describe("contrastOnWhite", () => {
  it("a dark brand primary is legible (>= MIN); a pale yellow is not", () => {
    expect(contrastOnWhite("#2e5bff")).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(contrastOnWhite("#ffe100")).toBeLessThan(MIN_CONTRAST);
  });
});

describe("darkenHex (primary-hover derivation)", () => {
  it("produces a darker shade", () => {
    expect(darkenHex("#3366cc", 0.12)).toBe("#2d5ab4");
    // darker means lower luminance
    expect(relativeLuminance(darkenHex("#3366cc", 0.2))).toBeLessThan(relativeLuminance("#3366cc"));
  });
  it("passes through invalid input", () => {
    expect(darkenHex("nope", 0.1)).toBe("nope");
  });
});
