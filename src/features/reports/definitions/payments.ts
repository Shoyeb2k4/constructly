import { getPayments } from "@/features/payments/data";
import { filterTransactions, summarisePayments } from "@/features/payments/assemble";
import { paymentsVisibilityFor } from "@/features/payments/visibility";
import {
  PARTY_TYPE_LABEL,
  STATUS_META,
  TRANSACTION_TYPES,
  TRANSACTION_TYPE_LABEL,
} from "@/features/payments/constants";
import { PAYMENT_MODE_LABEL } from "@/features/procurement/constants";
import { projectsApi } from "@/features/projects/data";
import { formatPaiseCompact } from "@/lib/money";
import type {
  PaymentStatus,
  PaymentTransactionType,
  PaymentsFilters,
} from "@/features/payments/types";
import type { ReportDef, ReportResult, ReportRow } from "../types";
import { countKpi, echoFilters, monthlyPoints, moneyKpi, now, plural } from "./shared";

/**
 * The Payments report.
 *
 * This report writes NO cash logic. It calls `getPayments` — the same read
 * model `/payments` renders — then `filterTransactions` and
 * `summarisePayments`, which are the same pure functions the Payments Centre
 * calls. That is the entire point: the report and the operational page cannot
 * disagree, because there is only one implementation, and a test asserts the
 * totals match for the same period and filters.
 *
 * Everything the Payments Centre settled therefore holds here for free:
 * advance drawdowns, scope transfers, labour bills and settlement-reversal
 * bookkeeping are not cash and never appear; a settlement is one transaction at
 * its net cash; and reversed money is excluded from paid totals without being
 * netted against them or erased from history.
 */

/** The report exposes the same status vocabulary the Payments Centre uses. */
const STATUS_FILTER: Record<string, PaymentStatus | undefined> = {
  ALL: undefined,
  ACTIVE: "ACTIVE",
  REVERSED: "REVERSED",
};

const paymentsReport: ReportDef = {
  id: "payments",
  name: "Cash movement",
  question: "What money actually left the company, to whom, and for which project?",
  category: "Payments",
  filters: ["period", "project", "transactionType", "status"],
  defaultPeriod: "THIS_MONTH",
  featured: true,
  async run(f, ctx): Promise<ReportResult> {
    // The route already gated on `reports.view` + the report's class. WHICH
    // instruments this caller may see is the Payments module's own rule, asked
    // here rather than reimplemented — so a report can never show a contractor
    // advance to someone who could not see it on `/payments`.
    const visibility = paymentsVisibilityFor({
      id: ctx.userId,
      email: "",
      fullName: "",
      role: ctx.isOwner ? "OWNER" : "PROJECT_MANAGER",
      permissions: ctx.permissions,
      company: { id: "", name: "" },
    });

    const [snapshot, projects] = await Promise.all([
      getPayments({
        userId: ctx.userId,
        isOwner: ctx.isOwner,
        visibility,
        from: ctx.period.from,
        to: ctx.period.to,
      }),
      projectsApi.list({ includeArchived: true }),
    ]);

    const filters: PaymentsFilters = {
      projectId: f.projectId || "ALL",
      type: (f.transactionType as PaymentTransactionType) || "ALL",
      status: STATUS_FILTER[f.status ?? "ALL"] ?? "ALL",
    };
    // The SAME filter function the Payments Centre uses. The period is already
    // applied server-side by `getPayments`, so it is not re-applied here.
    const rows0 = filterTransactions(snapshot.transactions, filters);
    // And the SAME summariser. Nothing in this file adds a rupee to another.
    const summary = summarisePayments(rows0, ctx.period);

    const rows: ReportRow[] = rows0.map((t) => ({
      href: t.source.href,
      cells: [
        t.date,
        t.party.name,
        PARTY_TYPE_LABEL[t.party.type],
        TRANSACTION_TYPE_LABEL[t.type],
        t.project?.name ?? "No project",
        t.scopeLabel ?? "",
        t.paymentMode ? PAYMENT_MODE_LABEL[t.paymentMode] : "",
        t.reference ?? "",
        t.amountPaise,
        STATUS_META[t.status].label,
      ],
    }));

    // Only ACTIVE cash is totalled — the same rule `summarisePayments` applies.
    // A reversed row stays in the table above with its original amount.
    rows.push({
      kind: "total",
      cells: ["", "", "", "", "", "", "", "Paid (active)", summary.paidPaise, ""],
    });

    const active = rows0.filter((t) => t.status === "ACTIVE");
    const points = monthlyPoints(active.map((t) => ({ date: t.date, amountPaise: t.amountPaise })));

    const byType = summary.byType.filter((b) => b.count > 0);

    return {
      id: this.id,
      title: "Cash movement",
      subtitle: plural(rows0.length, "transaction"),
      generatedAt: now(),
      periodLabel: ctx.period.label,
      activeFilters: echoFilters(f, {
        project: new Map(projects.map((p) => [p.id, p.name])),
        transactionType: new Map(
          TRANSACTION_TYPES.map((t) => [t, TRANSACTION_TYPE_LABEL[t]] as const),
        ),
        status: new Map(Object.entries(STATUS_META).map(([k, v]) => [k, v.label])),
      }),
      kpis: [
        moneyKpi("Paid", summary.paidPaise, `${summary.paidCount} active, reversals excluded`),
        moneyKpi("To contractors", summary.contractorPaidPaise),
        moneyKpi("To vendors", summary.vendorPaidPaise),
        summary.reversedCount > 0
          ? moneyKpi(
              "Reversed",
              summary.reversedPaise,
              `${summary.reversedCount} reversed, not counted above`,
            )
          : countKpi("Reversed", 0, "Nothing reversed in this period"),
      ],
      columns: [
        { key: "date", label: "Date", kind: "date" },
        { key: "party", label: "Paid to" },
        { key: "partyType", label: "Party", hideBelow: "xl" },
        { key: "type", label: "Type", hideBelow: "md" },
        { key: "project", label: "Project", hideBelow: "lg" },
        { key: "against", label: "Against", hideBelow: "xl" },
        { key: "mode", label: "Mode", hideBelow: "xl" },
        { key: "reference", label: "Reference", hideBelow: "xl" },
        { key: "amount", label: "Amount", kind: "money" },
        { key: "status", label: "Status", hideBelow: "lg" },
      ],
      rows,
      chart:
        points.length > 1
          ? {
              title: "Active cash paid by month",
              kind: "money" as const,
              description: `Active cash movement per month across ${ctx.period.label}: ${byType
                .map((b) => `${TRANSACTION_TYPE_LABEL[b.type]} ${formatPaiseCompact(b.amountPaise)}`)
                .join(", ")}. Every transaction is listed in the table below.`,
              points,
            }
          : undefined,
      note:
        "Only cash that actually moved is counted. An advance drawn down by a settlement, a re-scope of unused advance money and an attribution correction all carry rupee amounts and none of them is a payment. A settlement appears once, for the net cash it paid. Contractor advances and settlements record no payment mode, so filtering by mode would exclude them.",
      isEmpty: rows0.length === 0,
      hasAnyData: snapshot.hasAnyPayments,
    };
  },
};

export const PAYMENT_REPORTS: ReportDef[] = [paymentsReport];
