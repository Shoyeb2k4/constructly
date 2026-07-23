import { describe, it, expect } from "vitest";
import { poComparator } from "./sort";
import type { PurchaseOrderListItem, POSort } from "./types";

function po(over: Partial<PurchaseOrderListItem> & { id: string }): PurchaseOrderListItem {
  return {
    poNumber: "PO-0001",
    status: "DRAFT",
    purchaseDate: "2026-01-01",
    expectedDelivery: null,
    subtotalPaise: 0,
    gstPaise: 0,
    totalPaise: 0,
    paidPaise: 0,
    paymentStatus: "UNPAID",
    invoiceNumber: null,
    vendor: { id: "v", name: "Vendor" },
    project: { id: "p", name: "Project", code: "PRJ" },
    createdBy: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

const order = (items: PurchaseOrderListItem[], sort: POSort) =>
  [...items].sort(poComparator(sort)).map((i) => i.id);

describe("poComparator", () => {
  it("NEWEST: latest purchase date first", () => {
    const items = [
      po({ id: "old", purchaseDate: "2026-01-01" }),
      po({ id: "new", purchaseDate: "2026-06-01" }),
      po({ id: "mid", purchaseDate: "2026-03-01" }),
    ];
    expect(order(items, "NEWEST")).toEqual(["new", "mid", "old"]);
  });

  it("OLDEST: earliest first", () => {
    const items = [
      po({ id: "new", purchaseDate: "2026-06-01" }),
      po({ id: "old", purchaseDate: "2026-01-01" }),
    ];
    expect(order(items, "OLDEST")).toEqual(["old", "new"]);
  });

  it("AMOUNT_DESC / AMOUNT_ASC", () => {
    const items = [
      po({ id: "lo", totalPaise: 100 }),
      po({ id: "hi", totalPaise: 900 }),
      po({ id: "mid", totalPaise: 500 }),
    ];
    expect(order(items, "AMOUNT_DESC")).toEqual(["hi", "mid", "lo"]);
    expect(order(items, "AMOUNT_ASC")).toEqual(["lo", "mid", "hi"]);
  });

  it("VENDOR_ASC / VENDOR_DESC", () => {
    const items = [
      po({ id: "b", vendor: { id: "1", name: "Bharat" } }),
      po({ id: "a", vendor: { id: "2", name: "Asian" } }),
      po({ id: "c", vendor: { id: "3", name: "Cement Co" } }),
    ];
    expect(order(items, "VENDOR_ASC")).toEqual(["a", "b", "c"]);
    expect(order(items, "VENDOR_DESC")).toEqual(["c", "b", "a"]);
  });

  it("PROJECT_ASC", () => {
    const items = [
      po({ id: "z", project: { id: "1", name: "Zenith", code: "Z" } }),
      po({ id: "a", project: { id: "2", name: "Alpha", code: "A" } }),
    ];
    expect(order(items, "PROJECT_ASC")).toEqual(["a", "z"]);
  });

  it("PO_NUMBER: numeric-aware", () => {
    const items = [
      po({ id: "10", poNumber: "PO-0010" }),
      po({ id: "2", poNumber: "PO-0002" }),
      po({ id: "1", poNumber: "PO-0001" }),
    ];
    expect(order(items, "PO_NUMBER")).toEqual(["1", "2", "10"]);
  });

  it("STATUS: DRAFT → SUBMITTED → APPROVED", () => {
    const items = [
      po({ id: "ap", status: "APPROVED" }),
      po({ id: "dr", status: "DRAFT" }),
      po({ id: "su", status: "SUBMITTED" }),
    ];
    expect(order(items, "STATUS")).toEqual(["dr", "su", "ap"]);
  });

  it("DELIVERY: by date, nulls last", () => {
    const items = [
      po({ id: "none", expectedDelivery: null }),
      po({ id: "late", expectedDelivery: "2026-09-01" }),
      po({ id: "soon", expectedDelivery: "2026-02-01" }),
    ];
    expect(order(items, "DELIVERY")).toEqual(["soon", "late", "none"]);
  });

  it("defaults to NEWEST", () => {
    const items = [
      po({ id: "old", purchaseDate: "2026-01-01" }),
      po({ id: "new", purchaseDate: "2026-06-01" }),
    ];
    expect(order(items, undefined as unknown as POSort)).toEqual(["new", "old"]);
  });
});
