import { describe, it, expect } from "vitest";
import {
  caretAfterFormat,
  formatMoneyInput,
  groupIndian,
  paiseToInput,
  parseMoneyInput,
} from "./money-input";

/**
 * Money entry is where a formatting bug becomes a wrong invoice.
 *
 * Two properties are defended above all: what the user sees is Indian-grouped
 * while they type, and what the domain receives is integer paise that survives a
 * round trip. Everything else is detail.
 */

describe("Indian grouping", () => {
  it.each([
    ["1", "1"],
    ["12", "12"],
    ["999", "999"],
    ["1000", "1,000"],
    ["10000", "10,000"],
    ["100000", "1,00,000"],
    ["1000000", "10,00,000"],
    ["1250000", "12,50,000"],
    ["10000000", "1,00,00,000"],
    ["12345678", "1,23,45,678"],
    ["1234567890", "1,23,45,67,890"],
  ])("groups %s as %s", (input, expected) => {
    expect(groupIndian(input)).toBe(expected);
  });
});

describe("formatting as the user types", () => {
  it.each([
    ["1", "1"],
    ["1000", "1,000"],
    ["10000", "10,000"],
    ["100000", "1,00,000"],
    ["1000000", "10,00,000"],
    ["1250000", "12,50,000"],
    ["12345678", "1,23,45,678"],
    ["12345678.5", "1,23,45,678.5"],
    ["12345678.50", "1,23,45,678.50"],
  ])("shows %s as %s", (raw, expected) => {
    expect(formatMoneyInput(raw)).toBe(expected);
  });

  it("keeps a half-typed decimal rather than normalising it away", () => {
    // Someone typing "1000.50" passes through both of these. A formatter that
    // tidies them is fighting the person at the keyboard.
    expect(formatMoneyInput("1000.")).toBe("1,000.");
    expect(formatMoneyInput("1000.5")).toBe("1,000.5");
    expect(formatMoneyInput("1000.50")).toBe("1,000.50");
    expect(formatMoneyInput(".5")).toBe(".5");
  });

  it("caps the decimals and ignores a second decimal point", () => {
    expect(formatMoneyInput("1000.567")).toBe("1,000.56");
    expect(formatMoneyInput("10.5.5")).toBe("10.55");
  });

  it("collapses leading zeros without eating a real zero", () => {
    expect(formatMoneyInput("007")).toBe("7");
    expect(formatMoneyInput("0")).toBe("0");
    expect(formatMoneyInput("0.50")).toBe("0.50");
  });

  it("drops decimals entirely on a whole-rupee field", () => {
    expect(formatMoneyInput("1000.50", { decimals: 0 })).toBe("1,00,050");
    expect(formatMoneyInput("12345678", { decimals: 0 })).toBe("1,23,45,678");
  });

  it("keeps a minus only where the field allows one", () => {
    expect(formatMoneyInput("-5000", { allowNegative: true })).toBe("-5,000");
    expect(formatMoneyInput("-5000")).toBe("5,000");
  });

  it("returns empty for empty, never zero", () => {
    expect(formatMoneyInput("")).toBe("");
  });
});

describe("parsing to paise", () => {
  it.each([
    ["1", 100],
    ["1000", 100_000],
    ["1,000", 100_000],
    ["1,00,000", 10_000_000],
    ["12,50,000", 125_000_000],
    ["1,23,45,678", 1_234_567_800],
    ["1000.5", 100_050],
    ["1000.50", 100_050],
    ["1000.05", 100_005],
    ["0", 0],
    ["0.01", 1],
  ])("parses %s to %d paise", (raw, expected) => {
    expect(parseMoneyInput(raw)).toBe(expected);
  });

  it("accepts what a person might realistically paste", () => {
    expect(parseMoneyInput("125000")).toBe(12_500_000);
    expect(parseMoneyInput("1,25,000")).toBe(12_500_000);
    expect(parseMoneyInput("₹1,25,000")).toBe(12_500_000);
    expect(parseMoneyInput("₹ 1,25,000.50")).toBe(12_500_050);
    expect(parseMoneyInput("Rs. 1,25,000")).toBe(12_500_000);
    expect(parseMoneyInput("INR 1,25,000")).toBe(12_500_000);
    // A non-breaking space, as a spreadsheet copy produces.
    expect(parseMoneyInput("1,25,000 ")).toBe(12_500_000);
  });

  it("refuses garbage instead of salvaging a plausible number from it", () => {
    // "12abc34" must never quietly become ₹1,234.
    for (const bad of ["12abc34", "abc", "1,2,3.4.5x", "--5", "₹₹100", "1e5"]) {
      expect(parseMoneyInput(bad), `"${bad}" was accepted`).toBeNull();
    }
  });

  it("tells empty apart from zero", () => {
    // A required field must be able to distinguish "not filled in" from "₹0".
    expect(parseMoneyInput("")).toBeNull();
    expect(parseMoneyInput("   ")).toBeNull();
    expect(parseMoneyInput("0")).toBe(0);
  });

  it("rejects paise on a whole-rupee field rather than swallowing them", () => {
    expect(parseMoneyInput("1000.50", { decimals: 0 })).toBeNull();
    // …but a decimal that is genuinely zero is harmless.
    expect(parseMoneyInput("1000.00", { decimals: 0 })).toBe(100_000);
  });

  it("rejects a negative unless the field permits one", () => {
    expect(parseMoneyInput("-5000")).toBeNull();
    expect(parseMoneyInput("-5000", { allowNegative: true })).toBe(-500_000);
  });

  it("refuses an amount too large to stay an exact integer", () => {
    expect(parseMoneyInput("999999999999999999999")).toBeNull();
  });
});

describe("paise round trip", () => {
  it.each([
    0, 1, 50, 100, 999, 100_000, 12_500_000, 1_234_567_800, 999_999_999,
    100_050, 100_005, 8_00_00_000,
  ])("survives %d paise unchanged", (paise) => {
    expect(parseMoneyInput(paiseToInput(paise))).toBe(paise);
  });

  it("holds across a broad sweep — parse(format(paise)) === paise", () => {
    for (let paise = 0; paise < 2_000_000; paise += 997) {
      const round = parseMoneyInput(paiseToInput(paise));
      expect(round, `round trip lost ${paise}`).toBe(paise);
    }
  });

  it("holds for the .5 case float arithmetic gets wrong", () => {
    // `Math.round(12345678.5 * 100)` is exactly the trap this avoids by
    // splitting rupees and paise as strings.
    expect(parseMoneyInput("12345678.50")).toBe(1_234_567_850);
    expect(parseMoneyInput("8.35")).toBe(835);
    expect(parseMoneyInput("1.005")).toBe(100);
  });

  it("renders a round amount without decimal noise", () => {
    expect(paiseToInput(100_000)).toBe("1,000");
    expect(paiseToInput(100_050)).toBe("1,000.50");
    expect(paiseToInput(1)).toBe("0.01");
    expect(paiseToInput(null)).toBe("");
  });
});

describe("caret position", () => {
  it("counts digits, not characters, so a new comma does not move it", () => {
    // "1000" → "1,000": the caret was after 4 digits and must stay there.
    expect(caretAfterFormat("1,000", 4, "1000")).toBe(5);
  });

  it("keeps the caret when inserting in the middle", () => {
    // "1,00,000" with the caret after "1,00" (3 digits) stays after 3 digits.
    expect(caretAfterFormat("1,00,000", 4, "1,0000")).toBe(4);
  });

  it("parks before the first digit when nothing precedes the caret", () => {
    expect(caretAfterFormat("1,000", 0, "1000")).toBe(0);
  });
});
