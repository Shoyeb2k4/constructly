import { describe, it, expect } from "vitest";
import { isPaymentLocked, assertPaymentEditable, assertDifferentApprover } from "./payment-workflow";

describe("payment posted-lock (prepared for approval/posting workflow)", () => {
  it("APPROVED and POSTED payments are locked", () => {
    expect(isPaymentLocked("APPROVED")).toBe(true);
    expect(isPaymentLocked("POSTED")).toBe(true);
  });
  it("draft/submitted/cancelled/none are not locked", () => {
    for (const s of ["DRAFT", "SUBMITTED", "CANCELLED", null, undefined]) {
      expect(isPaymentLocked(s)).toBe(false);
    }
  });
  it("assertPaymentEditable refuses a locked payment (ordinary edit cannot modify)", () => {
    expect(() => assertPaymentEditable("APPROVED")).toThrow("IMMUTABLE");
    expect(() => assertPaymentEditable("DRAFT")).not.toThrow();
  });
});

describe("maker-checker (creator ≠ approver)", () => {
  it("throws when the approver is the creator", () => {
    expect(() => assertDifferentApprover("u1", "u1")).toThrow("MAKER_CHECKER");
  });
  it("allows a different approver", () => {
    expect(() => assertDifferentApprover("u1", "u2")).not.toThrow();
  });
});
