import type { POSort, PurchaseOrderListItem } from "./types";

const STATUS_ORDER: Record<string, number> = { DRAFT: 0, SUBMITTED: 1, APPROVED: 2 };

/**
 * Pure comparator for a PO list, shared by the demo repository and tests. The
 * Prisma-backed server sorts in the database (see poOrderBy in server/actions),
 * so this must stay in lock-step with that mapping.
 */
export function poComparator(
  sort: POSort = "NEWEST",
): (a: PurchaseOrderListItem, b: PurchaseOrderListItem) => number {
  switch (sort) {
    case "OLDEST":
      return (a, b) =>
        a.purchaseDate.localeCompare(b.purchaseDate) || a.poNumber.localeCompare(b.poNumber);
    case "AMOUNT_DESC":
      return (a, b) => b.totalPaise - a.totalPaise;
    case "AMOUNT_ASC":
      return (a, b) => a.totalPaise - b.totalPaise;
    case "VENDOR_ASC":
      return (a, b) => a.vendor.name.localeCompare(b.vendor.name);
    case "VENDOR_DESC":
      return (a, b) => b.vendor.name.localeCompare(a.vendor.name);
    case "PROJECT_ASC":
      return (a, b) => a.project.name.localeCompare(b.project.name);
    case "PO_NUMBER":
      return (a, b) => a.poNumber.localeCompare(b.poNumber, undefined, { numeric: true });
    case "STATUS":
      return (a, b) =>
        (STATUS_ORDER[a.status] ?? 0) - (STATUS_ORDER[b.status] ?? 0) ||
        a.poNumber.localeCompare(b.poNumber);
    case "DELIVERY":
      return (a, b) => {
        // Nulls last, then by date.
        if (!a.expectedDelivery && !b.expectedDelivery) return 0;
        if (!a.expectedDelivery) return 1;
        if (!b.expectedDelivery) return -1;
        return a.expectedDelivery.localeCompare(b.expectedDelivery);
      };
    case "NEWEST":
    default:
      return (a, b) =>
        b.purchaseDate.localeCompare(a.purchaseDate) || b.poNumber.localeCompare(a.poNumber);
  }
}
