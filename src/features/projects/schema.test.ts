import { describe, it, expect } from "vitest";
import {
  projectFormSchema,
  formToInput,
  updateProjectInputSchema,
  budgetSectionSchema,
  budgetSectionToPatch,
  clientSectionSchema,
  clientSectionToPatch,
  locationSectionSchema,
  locationSectionToPatch,
} from "./schema";

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

describe("updateProjectInputSchema (server-side patch validation)", () => {
  it("accepts a valid partial patch", () => {
    const r = updateProjectInputSchema.safeParse({ clientName: "Nirvana", budgetPaise: 1000 });
    expect(r.success).toBe(true);
  });

  it("rejects negative and non-integer paise", () => {
    expect(updateProjectInputSchema.safeParse({ budgetPaise: -1 }).success).toBe(false);
    expect(updateProjectInputSchema.safeParse({ budgetPaise: 10.5 }).success).toBe(false);
  });

  it("rejects out-of-range GPS and bad email", () => {
    expect(updateProjectInputSchema.safeParse({ gpsLat: 200 }).success).toBe(false);
    expect(updateProjectInputSchema.safeParse({ clientEmail: "not-an-email" }).success).toBe(false);
  });

  it("rejects completion before start when both are present", () => {
    const r = updateProjectInputSchema.safeParse({
      startDate: "2026-06-01",
      expectedCompletionDate: "2026-05-01",
    });
    expect(r.success).toBe(false);
  });

  it("strips unknown keys (e.g. pmId) rather than persisting them", () => {
    const r = updateProjectInputSchema.parse({ clientName: "Y", pmId: "abc", code: "PRJ-1" });
    expect(r).not.toHaveProperty("pmId");
    expect(r).not.toHaveProperty("code");
    expect(r.clientName).toBe("Y");
  });

  it("allows clearing nullable fields to null", () => {
    const r = updateProjectInputSchema.safeParse({ clientName: null, gpsLat: null, gpsLng: null });
    expect(r.success).toBe(true);
  });
});

describe("section edit schemas + converters", () => {
  it("budget: converts rupees to paise, blank procurement → null", () => {
    const patch = budgetSectionToPatch(
      budgetSectionSchema.parse({ budgetRupees: 100, contractValueRupees: 200, procurementBudgetRupees: "" }),
    );
    expect(patch.budgetPaise).toBe(10_000);
    expect(patch.contractValuePaise).toBe(20_000);
    expect(patch.procurementBudgetPaise).toBeNull();
  });

  it("client: empty strings become null", () => {
    const patch = clientSectionToPatch(
      clientSectionSchema.parse({ clientName: "Acme", clientContact: "", clientPhone: "", clientEmail: "", siteAddress: "" }),
    );
    expect(patch.clientName).toBe("Acme");
    expect(patch.clientContact).toBeNull();
    expect(patch.clientPhone).toBeNull();
  });

  it("location: blank coordinates clear to null; both-or-neither enforced", () => {
    expect(locationSectionSchema.safeParse({ gpsLat: "12.9", gpsLng: "" }).success).toBe(false);
    const patch = locationSectionToPatch(locationSectionSchema.parse({ gpsLat: "", gpsLng: "" }));
    expect(patch.gpsLat).toBeNull();
    expect(patch.gpsLng).toBeNull();
    const set = locationSectionToPatch(locationSectionSchema.parse({ gpsLat: "12.97", gpsLng: "77.59" }));
    expect(set.gpsLat).toBeCloseTo(12.97);
    expect(set.gpsLng).toBeCloseTo(77.59);
  });
});
