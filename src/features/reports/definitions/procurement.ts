import { procurementApi } from "@/features/procurement/data";
import { projectsApi } from "@/features/projects/data";
import { PO_STATUS_LABEL, PO_PAYMENT_STATUS_LABEL } from "@/features/procurement/constants";
import type { ReportDef, ReportResult, ReportRow } from "../types";
import { countKpi, echoFilters, moneyKpi, now, plural } from "./shared";

/**
 * Procurement reports.
 *
 * The module's accepted vocabulary, unchanged: Ordered value, Paid against
 * orders, Still owed. Two things are deliberately absent, because the domain
 * does not support them and a report is the easiest place to imply otherwise:
 *
 *   PAID IS NOT DELIVERED. There is no receiving or goods-receipt state in the
 *   product, so nothing here reports on delivery performance.
 *
 *   AN EXPECTED DATE IS NOT A PROMISE KEPT. Without a receipt to compare it to,
 *   an expected-delivery column can only ever show a plan, never an outcome.
 */

const procurementReport: ReportDef = {
  id: "procurement",
  name: "Purchase orders",
  question: "What was ordered, from whom, and how much of it is still owed?",
  category: "Procurement",
  filters: ["period", "project", "vendor"],
  defaultPeriod: "THIS_MONTH",
  async run(f, ctx): Promise<ReportResult> {
    const [pos, allPos, projects, vendors] = await Promise.all([
      procurementApi.listPurchaseOrders({
        projectId: f.projectId || "ALL",
        vendorId: f.vendorId || "ALL",
        dateFrom: f.dateFrom,
        dateTo: f.dateTo,
      }),
      // Unbounded, purely so an empty month cannot be mistaken for a company
      // that has never raised a purchase order.
      procurementApi.listPurchaseOrders({}),
      projectsApi.list({ includeArchived: true }),
      procurementApi.listVendors(),
    ]);

    const rows: ReportRow[] = pos.map((p) => ({
      href: `/procurement/${p.id}`,
      cells: [
        p.poNumber,
        p.vendor.name,
        p.project.name,
        p.purchaseDate,
        PO_STATUS_LABEL[p.status],
        p.subtotalPaise,
        p.gstPaise,
        p.totalPaise,
        p.paidPaise,
        Math.max(0, p.totalPaise - p.paidPaise),
        PO_PAYMENT_STATUS_LABEL[p.paymentStatus],
      ],
    }));

    const t = pos.reduce(
      (a, p) => {
        a.sub += p.subtotalPaise;
        a.gst += p.gstPaise;
        a.total += p.totalPaise;
        a.paid += p.paidPaise;
        a.owed += Math.max(0, p.totalPaise - p.paidPaise);
        return a;
      },
      { sub: 0, gst: 0, total: 0, paid: 0, owed: 0 },
    );
    rows.push({
      kind: "total",
      cells: ["", "", "", "", "Total", t.sub, t.gst, t.total, t.paid, t.owed, ""],
    });

    const awaiting = pos.filter((p) => p.status === "SUBMITTED").length;

    return {
      id: this.id,
      title: "Purchase orders",
      subtitle: plural(pos.length, "purchase order"),
      generatedAt: now(),
      periodLabel: ctx.period.label,
      activeFilters: echoFilters(f, {
        project: new Map(projects.map((p) => [p.id, p.name])),
        vendor: new Map(vendors.map((v) => [v.id, v.businessName])),
      }),
      kpis: [
        moneyKpi("Ordered value", t.total, "Including GST"),
        moneyKpi("Paid against orders", t.paid),
        moneyKpi("Still owed", t.owed, "Ordered value not yet paid"),
        countKpi("Awaiting approval", awaiting),
      ],
      columns: [
        { key: "po", label: "PO" },
        { key: "vendor", label: "Vendor" },
        { key: "project", label: "Project", hideBelow: "xl" },
        { key: "date", label: "Date", kind: "date", hideBelow: "lg" },
        { key: "status", label: "Status", hideBelow: "md" },
        { key: "subtotal", label: "Subtotal", kind: "money", hideBelow: "xl" },
        { key: "gst", label: "GST", kind: "money", hideBelow: "xl" },
        { key: "total", label: "Ordered value", kind: "money" },
        { key: "paid", label: "Paid", kind: "money", hideBelow: "lg" },
        { key: "owed", label: "Still owed", kind: "money" },
        { key: "payment", label: "Payment", hideBelow: "lg" },
      ],
      rows,
      note: "Ordered value and Still owed describe money. Neither says anything about delivery — Constructly records no goods receipt, so nothing here reports on whether materials arrived.",
      isEmpty: pos.length === 0,
      hasAnyData: allPos.length > 0,
    };
  },
};

/* ── Vendor summary ──────────────────────────────────────────────────── */

const vendorReport: ReportDef = {
  id: "vendor-summary",
  name: "Vendor summary",
  question: "Which vendors do we buy the most from, and what is still owed to them?",
  category: "Procurement",
  filters: ["vendor"],
  async run(f): Promise<ReportResult> {
    const vendors = await procurementApi.listVendors();
    const scoped = f.vendorId ? vendors.filter((v) => v.id === f.vendorId) : vendors;
    const rows: ReportRow[] = scoped
      .slice()
      .sort((a, b) => b.totalPurchasedPaise - a.totalPurchasedPaise)
      .map((v) => ({
        href: `/vendors/${v.id}`,
        cells: [
          v.businessName,
          v.status === "ACTIVE" ? "Active" : "Inactive",
          v.poCount,
          v.projectsServed,
          v.totalPurchasedPaise,
          Math.max(0, v.outstandingPaise),
        ],
      }));
    const purchased = scoped.reduce((s, v) => s + v.totalPurchasedPaise, 0);
    const outstanding = scoped.reduce((s, v) => s + Math.max(0, v.outstandingPaise), 0);
    rows.push({ kind: "total", cells: ["Total", "", "", "", purchased, outstanding] });
    return {
      id: this.id,
      title: "Vendor summary",
      subtitle: plural(scoped.length, "vendor"),
      generatedAt: now(),
      periodLabel: "Lifetime",
      activeFilters: echoFilters(f, {
        vendor: new Map(vendors.map((v) => [v.id, v.businessName])),
      }),
      kpis: [
        countKpi("Vendors", scoped.length),
        moneyKpi("Ordered value", purchased, "Lifetime, across every project"),
        moneyKpi("Still owed", outstanding),
      ],
      columns: [
        { key: "vendor", label: "Vendor" },
        { key: "status", label: "Status", hideBelow: "lg" },
        { key: "pos", label: "Orders", kind: "number", hideBelow: "md" },
        { key: "projects", label: "Projects", kind: "number", hideBelow: "xl" },
        { key: "purchased", label: "Ordered value", kind: "money" },
        { key: "outstanding", label: "Still owed", kind: "money" },
      ],
      rows,
      note: "Still owed is what remains unpaid against orders raised with this vendor. It is a procurement figure and must not be added to a contractor's Currently due — the two rest on different commercial bases.",
      isEmpty: scoped.length === 0,
      hasAnyData: vendors.length > 0,
    };
  },
};

export const PROCUREMENT_REPORTS: ReportDef[] = [procurementReport, vendorReport];
