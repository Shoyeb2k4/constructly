import { describe, it, expect } from "vitest";
import { projectFormSchema, formToInput } from "./schema";

const valid = {
  name: "Skyline Residency",
  type: "COMMERCIAL" as const,
  budgetRupees: 12000000,
  contractValueRupees: 13500000,
};

describe("projectFormSchema", () => {
  it("accepts a minimal valid project", () => {
    expect(projectFormSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects completion date before start date", () => {
    const r = projectFormSchema.safeParse({
      ...valid,
      startDate: "2026-06-01",
      expectedCompletionDate: "2026-05-01",
    });
    expect(r.success).toBe(false);
  });

  it("requires both GPS coordinates or neither", () => {
    expect(projectFormSchema.safeParse({ ...valid, gpsLat: 12.9 }).success).toBe(false);
    expect(
      projectFormSchema.safeParse({ ...valid, gpsLat: 12.9, gpsLng: 77.5 }).success,
    ).toBe(true);
  });

  it("validates Indian phone numbers", () => {
    expect(projectFormSchema.safeParse({ ...valid, clientPhone: "12345" }).success).toBe(false);
    expect(
      projectFormSchema.safeParse({ ...valid, clientPhone: "+919845012345" }).success,
    ).toBe(true);
  });

  it("converts rupees to integer paise via formToInput", () => {
    const parsed = projectFormSchema.parse(valid);
    const input = formToInput(parsed);
    expect(input.budgetPaise).toBe(1_200_000_000);
    expect(input.contractValuePaise).toBe(1_350_000_000);
  });
});
