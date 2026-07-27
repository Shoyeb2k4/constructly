import { describe, it, expect } from "vitest";
import { encodePOQuery, decodePOQuery, countActiveFilters } from "./url-filters";
import type { POFilters } from "./types";

const decode = (qs: string) => decodePOQuery(new URLSearchParams(qs));

describe("URL filter persistence", () => {
  it("empty query → no filters, page 1", () => {
    const { filters, page } = decode("");
    expect(countActiveFilters(filters)).toBe(0);
    expect(page).toBe(1);
    expect(encodePOQuery({ filters: {}, page: 1 })).toBe("");
  });

  it("round-trips a rich filter set (multiple filters + search together)", () => {
    const filters: POFilters = {
      search: "cement",
      status: "APPROVED",
      projectId: "proj-1",
      vendorId: "vend-1",
      material: "Steel",
      category: "Structural",
      paymentStatus: "PARTIAL",
      createdById: "user-1",
      gst: "WITH",
      amountMinPaise: 500_000,
      amountMaxPaise: 2_500_000,
      dateFrom: "2026-01-01",
      dateTo: "2026-06-30",
      sort: "AMOUNT_DESC",
    };
    const round = decode(encodePOQuery({ filters, page: 3 }));
    expect(round.filters).toEqual(filters);
    expect(round.page).toBe(3);
  });

  it("search survives alongside filters (never dropped)", () => {
    const { filters } = decode(encodePOQuery({ filters: { search: "PO-0007", status: "DRAFT" }, page: 1 }));
    expect(filters.search).toBe("PO-0007");
    expect(filters.status).toBe("DRAFT");
  });

  it("stores amount in rupees but decodes to paise", () => {
    const qs = encodePOQuery({ filters: { amountMinPaise: 500_000 }, page: 1 });
    expect(qs).toContain("amin=5000");
    expect(decode(qs).filters.amountMinPaise).toBe(500_000);
  });

  it("omits the default sort and page 1", () => {
    expect(encodePOQuery({ filters: { sort: "NEWEST" }, page: 1 })).toBe("");
    expect(encodePOQuery({ filters: { sort: "OLDEST" }, page: 2 })).toBe("sort=OLDEST&page=2");
  });

  it('treats "ALL" sentinels as no filter', () => {
    const qs = encodePOQuery({ filters: { status: "ALL", projectId: "ALL", gst: "ALL" }, page: 1 });
    expect(qs).toBe("");
  });
});

describe("countActiveFilters", () => {
  it("ignores search and sort, counts real filters", () => {
    expect(countActiveFilters({ search: "x", sort: "OLDEST" })).toBe(0);
    expect(countActiveFilters({ status: "DRAFT", vendorId: "v1" })).toBe(2);
  });

  it("counts amount range and date range as one each", () => {
    expect(countActiveFilters({ amountMinPaise: 100 })).toBe(1);
    expect(countActiveFilters({ amountMinPaise: 100, amountMaxPaise: 900 })).toBe(1);
    expect(countActiveFilters({ dateFrom: "2026-01-01", dateTo: "2026-02-01" })).toBe(1);
  });

  it("counts all ten dimensions when set", () => {
    expect(
      countActiveFilters({
        status: "DRAFT",
        projectId: "p",
        vendorId: "v",
        material: "m",
        category: "c",
        paymentStatus: "PAID",
        createdById: "u",
        gst: "WITH",
        amountMinPaise: 1,
        dateFrom: "2026-01-01",
      }),
    ).toBe(10);
  });
});
