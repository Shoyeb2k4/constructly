import { describe, it, expect } from "vitest";
import { deadlineCountdown, budgetPct } from "./format";

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

describe("budgetPct", () => {
  it("returns 0 when no budget", () => expect(budgetPct(500, 0)).toBe(0));
  it("computes a percentage", () => expect(budgetPct(50, 100)).toBe(50));
  it("caps at 100 when over budget", () => expect(budgetPct(150, 100)).toBe(100));
});
