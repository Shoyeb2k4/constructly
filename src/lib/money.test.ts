import { describe, it, expect } from "vitest";
import {
  toPaise,
  toRupees,
  formatPaise,
  formatPaiseCompact,
  formatPaiseSmart,
  sumPaise,
} from "./money";

describe("money", () => {
  it("converts rupees to integer paise without float drift", () => {
    expect(toPaise(0.1)).toBe(10);
    expect(toPaise(19.99)).toBe(1999);
    expect(toPaise(1_20_00_000)).toBe(12_00_00_000_0);
  });

  it("round-trips paise to rupees", () => {
    expect(toRupees(1999)).toBe(19.99);
  });

  it("formats paise in Indian locale", () => {
    // grouping is 2,2,3 in en-IN
    expect(formatPaise(12_00_00_000_0, { whole: true })).toContain("1,20,00,000");
  });

  it("formats compact lakh/crore", () => {
    expect(formatPaiseCompact(toPaise(9_24_00_00))).toBe("₹92.4L");
    expect(formatPaiseCompact(toPaise(1_20_00_000))).toBe("₹1.2Cr");
    expect(formatPaiseCompact(toPaise(500))).toBe("₹500");
  });

  it("smart-formats: hides a bare .00 but keeps real paise, never rounds", () => {
    // whole rupees → no decimals
    expect(formatPaiseSmart(toPaise(37_04_725))).toBe("₹37,04,725");
    // exact paise preserved to 2 dp
    expect(formatPaiseSmart(toPaise(37_04_725.5))).toBe("₹37,04,725.50");
    expect(formatPaiseSmart(toPaise(37_04_725.25))).toBe("₹37,04,725.25");
    // a single paisa still shows (no rounding away)
    expect(formatPaiseSmart(1)).toBe("₹0.01");
    expect(formatPaiseSmart(0)).toBe("₹0");
  });

  it("sums paise integer-safely", () => {
    expect(sumPaise([10, 20, 30])).toBe(60);
  });
});
