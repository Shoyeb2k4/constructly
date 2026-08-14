/**
 * Pins the rupee→paise scale.
 *
 * These assertions exist because an off-by-10× seed is invisible to every other
 * test in the suite: if the scenario and its expectations are both written from
 * the same wrong literal, they agree perfectly and the acceptance case silently
 * runs at a tenth of its value. Each constant is checked against BOTH the exact
 * integer and the Indian-notation string a user would actually read.
 */
import { describe, it, expect } from "vitest";
import { formatPaiseSmart } from "@/lib/money";
import {
  rupees,
  lakhs,
  crores,
  RS_2L,
  RS_3L,
  RS_4L,
  RS_5L,
  RS_6L,
  RS_8L,
  RS_10L,
  RS_12L,
  RS_15L,
  RS_20L,
  RS_40L,
  RS_50L,
  RS_52L,
  RS_60L,
} from "./amounts";

describe("rupee → paise scale", () => {
  it("converts one lakh to ten million paise", () => {
    expect(lakhs(1)).toBe(10_000_000);
    expect(rupees(100_000)).toBe(10_000_000);
    expect(crores(1)).toBe(1_000_000_000);
  });

  it.each([
    ["RS_2L", RS_2L, 20_000_000, "₹2,00,000"],
    ["RS_3L", RS_3L, 30_000_000, "₹3,00,000"],
    ["RS_4L", RS_4L, 40_000_000, "₹4,00,000"],
    ["RS_5L", RS_5L, 50_000_000, "₹5,00,000"],
    ["RS_6L", RS_6L, 60_000_000, "₹6,00,000"],
    ["RS_8L", RS_8L, 80_000_000, "₹8,00,000"],
    ["RS_10L", RS_10L, 100_000_000, "₹10,00,000"],
    ["RS_12L", RS_12L, 120_000_000, "₹12,00,000"],
    ["RS_15L", RS_15L, 150_000_000, "₹15,00,000"],
    ["RS_20L", RS_20L, 200_000_000, "₹20,00,000"],
    ["RS_40L", RS_40L, 400_000_000, "₹40,00,000"],
    ["RS_50L", RS_50L, 500_000_000, "₹50,00,000"],
    ["RS_52L", RS_52L, 520_000_000, "₹52,00,000"],
    ["RS_60L", RS_60L, 600_000_000, "₹60,00,000"],
  ])("%s is %i paise and renders as %s", (_name, actual, expectedPaise, formatted) => {
    expect(actual).toBe(expectedPaise);
    expect(formatPaiseSmart(actual)).toBe(formatted);
  });

  it("the ₹60L agreement is NOT ₹6,00,000 (the 1/10th trap)", () => {
    expect(RS_60L).not.toBe(60_000_000);
    expect(RS_60L).toBe(RS_6L * 10);
  });

  it("keeps the acceptance-case arithmetic exact", () => {
    // Six equal milestones make up the whole agreement.
    expect(RS_10L * 6).toBe(RS_60L);
    // Slab 1: ₹6L settled attendance + ₹2L payments = ₹8L credited.
    expect(RS_6L + RS_2L).toBe(RS_8L);
    // Earned ₹10L − credited ₹8L = ₹2L currently due.
    expect(RS_10L - RS_8L).toBe(RS_2L);
    // Remaining unearned ₹50L, overall balance ₹52L.
    expect(RS_60L - RS_10L).toBe(RS_50L);
    expect(RS_60L - RS_8L).toBe(RS_52L);
  });

  it("produces integers only", () => {
    for (const v of [RS_2L, RS_6L, RS_10L, RS_60L, lakhs(0.5), rupees(1234.56)]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});
