import { describe, it, expect } from "vitest";
import {
  toPaise,
  toRupees,
  formatPaise,
  formatPaiseCompact,
  formatPaiseSmart,
  sumPaise,
  paiseFromBigInt,
  paiseFromNullableBigInt,
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

describe("paiseFromBigInt", () => {
  it("converts values JavaScript can represent exactly", () => {
    expect(paiseFromBigInt(BigInt(0), "x")).toBe(0);
    expect(paiseFromBigInt(BigInt(600_000_000), "x")).toBe(600_000_000); // Rs 60,00,000
    expect(paiseFromBigInt(BigInt(-42), "x")).toBe(-42);
  });

  it("accepts the safe-integer boundary itself", () => {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    expect(paiseFromBigInt(max, "x")).toBe(Number.MAX_SAFE_INTEGER);
    expect(paiseFromBigInt(BigInt(Number.MIN_SAFE_INTEGER), "x")).toBe(Number.MIN_SAFE_INTEGER);
  });

  it("throws one past the boundary rather than silently rounding", () => {
    // Number(9007199254740993n) quietly returns 9007199254740992 — a wrong
    // financial figure with no error. This is exactly what must not happen.
    const past = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1);
    expect(() => paiseFromBigInt(past, "settlement.labourBillPaise")).toThrow("MONEY_OUT_OF_RANGE");
    expect(() => paiseFromBigInt(past, "settlement.labourBillPaise")).toThrow(
      "settlement.labourBillPaise",
    );
    expect(() => paiseFromBigInt(-past, "x")).toThrow("MONEY_OUT_OF_RANGE");
  });

  it("treats a null aggregate as zero", () => {
    expect(paiseFromNullableBigInt(null, "x")).toBe(0);
    expect(paiseFromNullableBigInt(undefined, "x")).toBe(0);
    expect(paiseFromNullableBigInt(BigInt(500), "x")).toBe(500);
  });
});
