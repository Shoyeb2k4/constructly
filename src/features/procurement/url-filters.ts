import type {
  POFilters,
  POGstFilter,
  POPaymentStatus,
  POSort,
  PurchaseOrderStatus,
} from "./types";

/**
 * Serialize/deserialize the procurement list state (filters + sort + page) to
 * URL query params, so filters survive refresh, sharing, and paging. Pure and
 * unit-tested — the view is a thin wrapper around this.
 */
export interface POQueryState {
  filters: POFilters;
  page: number;
}

const DEFAULT_SORT: POSort = "NEWEST";

export function decodePOQuery(sp: URLSearchParams): POQueryState {
  const str = (k: string) => {
    const v = sp.get(k);
    return v && v.trim() !== "" ? v : undefined;
  };
  const num = (k: string) => {
    const v = sp.get(k);
    if (v == null || v.trim() === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const aminRupees = num("amin");
  const amaxRupees = num("amax");

  const filters: POFilters = {
    search: str("q"),
    status: str("status") as PurchaseOrderStatus | undefined,
    projectId: str("project"),
    vendorId: str("vendor"),
    material: str("material"),
    category: str("category"),
    paymentStatus: str("pay") as POPaymentStatus | undefined,
    createdById: str("by"),
    gst: str("gst") as POGstFilter | undefined,
    amountMinPaise: aminRupees != null ? Math.round(aminRupees * 100) : undefined,
    amountMaxPaise: amaxRupees != null ? Math.round(amaxRupees * 100) : undefined,
    dateFrom: str("from"),
    dateTo: str("to"),
    sort: str("sort") as POSort | undefined,
  };
  const page = Math.max(1, Math.floor(num("page") ?? 1));
  return { filters, page };
}

export function encodePOQuery({ filters, page }: POQueryState): string {
  const sp = new URLSearchParams();
  const set = (k: string, v?: string) => {
    if (v && v !== "ALL" && v.trim() !== "") sp.set(k, v);
  };
  set("q", filters.search?.trim());
  set("status", filters.status);
  set("project", filters.projectId);
  set("vendor", filters.vendorId);
  set("material", filters.material);
  set("category", filters.category);
  set("pay", filters.paymentStatus);
  set("by", filters.createdById);
  if (filters.gst && filters.gst !== "ALL") sp.set("gst", filters.gst);
  if (filters.amountMinPaise != null)
    sp.set("amin", String(Math.round(filters.amountMinPaise / 100)));
  if (filters.amountMaxPaise != null)
    sp.set("amax", String(Math.round(filters.amountMaxPaise / 100)));
  set("from", filters.dateFrom);
  set("to", filters.dateTo);
  if (filters.sort && filters.sort !== DEFAULT_SORT) sp.set("sort", filters.sort);
  if (page > 1) sp.set("page", String(page));
  return sp.toString();
}

/** Number of active filters (excludes free-text search and sort). Drives the badge. */
export function countActiveFilters(f: POFilters): number {
  let n = 0;
  const on = (v?: string) => v != null && v !== "ALL" && v.trim() !== "";
  if (on(f.status)) n++;
  if (on(f.projectId)) n++;
  if (on(f.vendorId)) n++;
  if (on(f.material)) n++;
  if (on(f.category)) n++;
  if (on(f.paymentStatus)) n++;
  if (on(f.createdById)) n++;
  if (f.gst && f.gst !== "ALL") n++;
  if (f.amountMinPaise != null || f.amountMaxPaise != null) n++;
  if (on(f.dateFrom) || on(f.dateTo)) n++;
  return n;
}
