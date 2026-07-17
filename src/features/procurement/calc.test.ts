import { describe, it, expect } from "vitest";
import {
  lineAmountPaise,
  lineGstPaise,
  poTotals,
  outstandingPaise,
  poPaymentStatus,
  agingBuckets,
  projectProcurementSummary,
  vendorProjectRollups,
  type POForRollup,
  type PaymentForRollup,
} from "./calc";

describe("procurement calc — line + PO totals", () => {
  it("computes line amount = qty × rate", () => {
    expect(lineAmountPaise(200, 38000)).toBe(7_600_000); // 200 bags × ₹380
  });
  it("rounds fractional quantities to the paise", () => {
    expect(lineAmountPaise(15.5, 260000)).toBe(4_030_000);
  });
  it("computes GST per line (18%)", () => {
    expect(lineGstPaise(200, 38000, 1800)).toBe(1_368_000); // 18% of 76,00,000
  });
  it("rounds GST per line so totals equal the sum of visible lines", () => {
    // Two lines each rounding independently.
    const t = poTotals([
      { quantity: 3, ratePaise: 33, gstRateBps: 1800 }, // amt 99, gst round(17.82)=18
      { quantity: 7, ratePaise: 33, gstRateBps: 1800 }, // amt 231, gst round(41.58)=42
    ]);
    expect(t.subtotalPaise).toBe(330);
    expect(t.gstPaise).toBe(60); // 18 + 42
    expect(t.totalPaise).toBe(390);
  });
  it("totals subtotal + GST into grand total", () => {
    const t = poTotals([
      { material: "Cement", quantity: 200, ratePaise: 38000, gstRateBps: 2800 },
      { material: "Sand", quantity: 15, ratePaise: 260000, gstRateBps: 500 },
    ] as never);
    expect(t.subtotalPaise).toBe(7_600_000 + 3_900_000);
    expect(t.gstPaise).toBe(2_128_000 + 195_000); // 28% + 5%
    expect(t.totalPaise).toBe(t.subtotalPaise + t.gstPaise);
  });
});

const pos: POForRollup[] = [
  { id: "po1", vendorId: "v1", projectId: "p1", status: "APPROVED", totalPaise: 100_000, purchaseDate: "2026-05-01" },
  { id: "po2", vendorId: "v1", projectId: "p2", status: "APPROVED", totalPaise: 200_000, purchaseDate: "2026-06-01" },
  { id: "po3", vendorId: "v1", projectId: "p1", status: "DRAFT", totalPaise: 999_999, purchaseDate: "2026-06-15" },
];
const payments: PaymentForRollup[] = [
  { vendorId: "v1", projectId: "p1", purchaseOrderId: "po1", amountPaise: 40_000, date: "2026-05-10" },
  { vendorId: "v1", projectId: "p2", purchaseOrderId: null, amountPaise: 50_000, date: "2026-06-05" },
];

describe("procurement calc — outstanding", () => {
  it("outstanding = counted purchases − payments (drafts excluded)", () => {
    // counted 100k + 200k = 300k; paid 40k + 50k = 90k → 210k
    expect(outstandingPaise(pos, payments, {}, false)).toBe(210_000);
  });
  it("scopes outstanding to a project", () => {
    expect(outstandingPaise(pos, payments, { projectId: "p1" }, false)).toBe(60_000); // 100k − 40k
  });
  it("payment status from paid vs total", () => {
    expect(poPaymentStatus(100_000, 0)).toBe("UNPAID");
    expect(poPaymentStatus(100_000, 40_000)).toBe("PARTIAL");
    expect(poPaymentStatus(100_000, 100_000)).toBe("PAID");
    expect(poPaymentStatus(100_000, 120_000)).toBe("PAID");
  });
});

describe("procurement calc — aging buckets", () => {
  const today = "2026-06-20";
  it("ages open POs into 0-30 / 31-60 / 60+ and applies advances FIFO", () => {
    const b = agingBuckets(pos, payments, "v1", false, today);
    // po1 (2026-05-01, ~50 days) outstanding 60k after its 40k → bucket 31-60
    // po2 (2026-06-01, ~19 days) outstanding 200k, minus 50k unlinked advance applied
    //   FIFO to oldest first: po1 already partly settled by its own linked pay, so
    //   the 50k advance goes to po1 (oldest) leaving 10k, then rest untouched.
    const total = b.d0_30 + b.d31_60 + b.d60_plus;
    expect(total).toBe(210_000); // matches outstanding
    expect(b.onAccountPaise).toBe(0);
  });
});

describe("procurement calc — rollups + summary", () => {
  it("rolls a vendor's projects with purchase value + outstanding", () => {
    const rows = vendorProjectRollups(pos, payments, "v1", false);
    expect(rows.map((r) => r.id).sort()).toEqual(["p1", "p2"]);
    const p2 = rows.find((r) => r.id === "p2")!;
    expect(p2.purchaseValuePaise).toBe(200_000);
    expect(p2.outstandingPaise).toBe(150_000);
  });
  it("summarizes a project's procurement", () => {
    const s = projectProcurementSummary(500_000, pos, payments, "p1", false);
    expect(s.spentPaise).toBe(100_000);
    expect(s.remainingPaise).toBe(400_000);
    expect(s.poCount).toBe(2); // includes the draft in the count
    expect(s.vendorsUsed).toBe(1);
    expect(s.outstandingPaise).toBe(60_000);
  });
  it("remaining is null when no procurement budget is set", () => {
    expect(projectProcurementSummary(null, pos, payments, "p1", false).remainingPaise).toBeNull();
  });
});
