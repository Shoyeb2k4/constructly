import { describe, it, expect } from "vitest";
import { deadlineCountdown, budgetPct, formatDate } from "./format";

const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe("deadlineCountdown", () => {
  it("flags overdue in red", () => {
    expect(deadlineCountdown(inDays(-3)).tone).toBe("danger");
    expect(deadlineCountdown(inDays(-3)).label).toMatch(/overdue/);
  });
  it("treats due-today as danger", () => {
    expect(deadlineCountdown(inDays(0))).toEqual({ label: "Due today", tone: "danger" });
  });
  it("warns within two weeks", () => {
    expect(deadlineCountdown(inDays(10)).tone).toBe("warning");
  });
  it("is calm when far out", () => {
    expect(deadlineCountdown(inDays(60)).tone).toBe("default");
  });
  it("shows done when completed", () => {
    expect(deadlineCountdown(inDays(-3), true)).toEqual({ label: "Done", tone: "done" });
  });
});

describe("formatDate (Bug 2: hydration-safe, IST-pinned)", () => {
  it("returns em dash for null", () => expect(formatDate(null)).toBe("—"));

  it("formats a plain date", () => {
    expect(formatDate("2026-08-12")).toBe("12 Aug 2026");
  });

  // The formatter is pinned to Asia/Kolkata, so a timestamp in the 18:30–24:00
  // UTC window renders as the NEXT IST day identically on server (UTC runtime)
  // and client (IST) — no #418. A UTC-zoned formatter would return "11 Aug 2026".
  it("renders timestamps in IST regardless of the runtime timezone", () => {
    expect(formatDate("2026-08-11T20:00:00.000Z")).toBe("12 Aug 2026");
    expect(formatDate("2026-08-11T23:30:00.000Z")).toBe("12 Aug 2026");
  });
});

describe("budgetPct", () => {
  it("returns 0 when no budget", () => expect(budgetPct(500, 0)).toBe(0));
  it("computes a percentage", () => expect(budgetPct(50, 100)).toBe(50));
  it("caps at 100 when over budget", () => expect(budgetPct(150, 100)).toBe(100));
});
