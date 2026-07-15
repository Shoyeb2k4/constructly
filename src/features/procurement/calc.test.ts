import { describe, it, expect } from "vitest";
import { lineAmountPaise, poTotalPaise } from "./calc";

describe("procurement calc", () => {
  it("computes line amount = qty × rate", () => {
    expect(lineAmountPaise(200, 38000)).toBe(7_600_000); // 200 bags × ₹380
  });
  it("rounds fractional quantities to the paise", () => {
    expect(lineAmountPaise(15.5, 260000)).toBe(4_030_000);
  });
  it("totals line items", () => {
    expect(
      poTotalPaise([
        { material: "Cement", quantity: 200, unit: "bag", ratePaise: 38000 },
        { material: "Sand", quantity: 15, unit: "ton", ratePaise: 260000 },
      ]),
    ).toBe(7_600_000 + 3_900_000);
  });
});
