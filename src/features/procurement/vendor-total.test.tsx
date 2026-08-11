/**
 * Vendor amount regression: the vendor screen must show the FULL amount (same
 * canonical value as the PDF/export), never the compact "₹32.7K" abbreviation
 * the client reported as "32.7". Values are chosen large enough to catch a
 * stray /100, /1000, or compact-formatter bug.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MoneyText } from "@/components/patterns/money-text";
import { formatPaiseSmart, formatPaiseCompact } from "@/lib/money";

describe("vendor total renders the complete amount", () => {
  it("shows ₹32,700 in full (the reported '32.7' case)", () => {
    const paise = 32_700_00; // ₹32,700 in paise
    const { container } = render(<MoneyText paise={paise} />);
    expect(container.textContent).toBe("₹32,700");
    // Must NOT be abbreviated to lakh/crore/thousand.
    expect(container.textContent).not.toMatch(/K|L|Cr/);
  });

  it("shows crore-scale amounts in full", () => {
    const paise = 1_23_45_678_00; // ₹1,23,45,678
    const { container } = render(<MoneyText paise={paise} />);
    expect(container.textContent).toBe("₹1,23,45,678");
  });

  it("proves the canonical (full) vs compact difference — the exact bug", () => {
    const paise = 32_700_00; // ₹32,700
    // The vendor screen now uses the full formatter (MoneyText default).
    expect(formatPaiseSmart(paise)).toBe("₹32,700");
    // The old `compact` prop abbreviated it to the reported value.
    expect(formatPaiseCompact(paise)).toBe("₹32.7K");
  });

  it("never loses paise precision on non-round amounts", () => {
    const paise = 32_700_50; // ₹32,700.50
    expect(formatPaiseSmart(paise)).toBe("₹32,700.50");
  });
});
