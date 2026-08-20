import { contractorsApi } from "@/features/contractors/data";
import { contractsApi } from "@/features/contracts/data";
import type { ReportDef, ReportResult, ReportRow } from "../types";
import { countKpi, echoFilters, moneyKpi, now, plural } from "./shared";

/**
 * Contractor reports.
 *
 * Every commercial figure comes from `getContractorProfile`, whose `lifetime`
 * is a `PortfolioReconciliation` produced by the agreement reconciliation
 * engine. Nothing here computes Authorised, Earned, Credited, Due or Ahead —
 * a second implementation of that arithmetic is precisely the failure this
 * phase exists to avoid, and the engine is the only thing allowed to do it.
 *
 * Two rules the engine enforces and this report must not soften:
 *
 *   DUE AND AHEAD STAY SEPARATE. A contractor can be owed money on one
 *   agreement and paid ahead on another at the same time. They are summed
 *   independently and never netted into one company-level position — the
 *   engine even labels its own net figure "informational only" for that reason.
 *
 *   UNSETTLED ATTENDANCE IS NOT CREDIT. It is recorded, shown separately, and
 *   never added to what has been credited.
 */

const contractorPosition: ReportDef = {
  id: "contractor-position",
  name: "Contractor position",
  question: "For each contractor: what was authorised, what has been earned, and what is due?",
  category: "Contractors",
  filters: ["contractor"],
  featured: true,
  async run(f): Promise<ReportResult> {
    const contractors = await contractorsApi.listContractors({ status: "ALL" });
    const scoped = f.contractorId
      ? contractors.filter((c) => c.id === f.contractorId)
      : contractors;

    // One profile read per contractor. Contractors are a bounded set — tens,
    // not thousands — and each read returns the engine's own reconciliation,
    // which is the only correct source for these figures. Measured in the phase
    // report; a batched aggregate belongs to the contracts module if the count
    // ever grows past that.
    const profiles = await Promise.all(
      scoped.map(async (c) => ({
        contractor: c,
        profile: await contractsApi.getContractorProfile(c.id),
      })),
    );

    const rows: ReportRow[] = [];
    const t = {
      authorised: 0,
      earned: 0,
      attendance: 0,
      other: 0,
      credited: 0,
      due: 0,
      ahead: 0,
      advance: 0,
      unsettled: 0,
      agreements: 0,
    };

    for (const { contractor, profile } of profiles) {
      const r = profile?.lifetime;
      if (!r) continue;
      t.authorised += r.totalContractValuePaise;
      t.earned += r.totalEarnedPaise;
      t.attendance += r.totalAttendanceCreditPaise;
      t.other += r.totalOtherPaymentCreditPaise;
      t.credited += r.totalCreditedPaise;
      t.due += r.totalCurrentDuePaise;
      t.ahead += r.totalAdvanceCreditPaise;
      t.advance += contractor.advanceBalancePaise;
      t.unsettled += r.totalUnsettledAttendancePaise;
      t.agreements += r.agreementCount;

      rows.push({
        href: `/labor/contractors/${contractor.id}?section=reconciliation`,
        cells: [
          contractor.name,
          r.agreementCount,
          r.totalContractValuePaise,
          r.totalEarnedPaise,
          r.totalAttendanceCreditPaise,
          r.totalOtherPaymentCreditPaise,
          r.totalCreditedPaise,
          r.totalCurrentDuePaise,
          r.totalAdvanceCreditPaise,
          contractor.advanceBalancePaise,
        ],
      });
    }

    rows.sort((a, b) => Number(b.cells[7]) - Number(a.cells[7]));
    rows.push({
      kind: "total",
      cells: [
        "Total",
        t.agreements,
        t.authorised,
        t.earned,
        t.attendance,
        t.other,
        t.credited,
        t.due,
        t.ahead,
        t.advance,
      ],
    });

    return {
      id: this.id,
      title: "Contractor position",
      subtitle: plural(profiles.length, "contractor"),
      generatedAt: now(),
      // Reconciliation is cumulative by definition — an agreement's earned value
      // is the whole of it to date — so this report takes no period and says so
      // rather than implying a monthly figure.
      periodLabel: "Agreement lifetime",
      activeFilters: echoFilters(f, {
        contractor: new Map(contractors.map((c) => [c.id, c.name])),
      }),
      kpis: [
        moneyKpi("Authorised", t.authorised, "Agreement value including approved amendments"),
        moneyKpi("Earned", t.earned, "Value of work recognised so far"),
        moneyKpi("Currently due", t.due, "Σ each agreement's due — never netted against ahead"),
        moneyKpi("Paid ahead", t.ahead, "Σ each agreement's advance credit"),
      ],
      columns: [
        { key: "contractor", label: "Contractor" },
        { key: "agreements", label: "Agreements", kind: "number", hideBelow: "xl" },
        { key: "authorised", label: "Authorised", kind: "money", hideBelow: "lg" },
        { key: "earned", label: "Earned", kind: "money" },
        { key: "attendance", label: "Attendance credit", kind: "money", hideBelow: "xl" },
        { key: "other", label: "Other payments", kind: "money", hideBelow: "xl" },
        { key: "credited", label: "Credited", kind: "money", hideBelow: "lg" },
        { key: "due", label: "Currently due", kind: "money" },
        { key: "ahead", label: "Paid ahead", kind: "money" },
        { key: "advance", label: "Advance balance", kind: "money", hideBelow: "lg" },
      ],
      rows,
      note:
        "Currently due and Paid ahead are summed separately and never netted: a contractor can be owed on one agreement and paid ahead on another at the same time. Advance balance is unspent prepaid labour cash and is not agreement credit.",
      isEmpty: profiles.length === 0,
      hasAnyData: contractors.length > 0,
    };
  },
};

/* ── Advances & settlements ──────────────────────────────────────────── */

const contractorSettlements: ReportDef = {
  id: "contractor-settlements",
  name: "Advances & settlements",
  question: "What has each contractor been advanced, billed and settled?",
  category: "Contractors",
  filters: ["contractor"],
  async run(f): Promise<ReportResult> {
    // The contractors module's own cross-contractor aggregate — one call, and
    // the same figures its cost summary screen shows.
    const [cost, contractors] = await Promise.all([
      contractorsApi.contractorCostSummary(),
      contractorsApi.listContractors({ status: "ALL" }),
    ]);
    const scoped = f.contractorId ? cost.filter((c) => c.contractorId === f.contractorId) : cost;

    const rows: ReportRow[] = scoped
      .slice()
      .sort((a, b) => b.totalBillPaise - a.totalBillPaise)
      .map((c) => ({
        href: `/labor/contractors/${c.contractorId}?section=payments`,
        cells: [
          c.name,
          c.settlementCount,
          c.totalBillPaise,
          c.totalAdjustedPaise,
          c.totalPaidPaise,
          c.advanceBalancePaise,
        ],
      }));

    const t = scoped.reduce(
      (a, c) => {
        a.bill += c.totalBillPaise;
        a.adjusted += c.totalAdjustedPaise;
        a.paid += c.totalPaidPaise;
        a.advance += c.advanceBalancePaise;
        a.settlements += c.settlementCount;
        return a;
      },
      { bill: 0, adjusted: 0, paid: 0, advance: 0, settlements: 0 },
    );
    rows.push({
      kind: "total",
      cells: ["Total", t.settlements, t.bill, t.adjusted, t.paid, t.advance],
    });

    return {
      id: this.id,
      title: "Advances & settlements",
      subtitle: plural(scoped.length, "contractor"),
      generatedAt: now(),
      periodLabel: "Lifetime",
      activeFilters: echoFilters(f, {
        contractor: new Map(contractors.map((c) => [c.id, c.name])),
      }),
      kpis: [
        moneyKpi("Labour billed", t.bill, "Σ settlement labour bills"),
        moneyKpi("Advance applied", t.adjusted, "Prepaid cash drawn down against those bills"),
        moneyKpi("Settlement cash paid", t.paid, "Net cash the settlements paid out"),
        moneyKpi("Advance balance", t.advance, "Prepaid cash not yet drawn down"),
      ],
      columns: [
        { key: "contractor", label: "Contractor" },
        { key: "settlements", label: "Settlements", kind: "number", hideBelow: "lg" },
        { key: "bill", label: "Labour billed", kind: "money" },
        { key: "adjusted", label: "Advance applied", kind: "money", hideBelow: "xl" },
        { key: "paid", label: "Settlement cash paid", kind: "money" },
        { key: "advance", label: "Advance balance", kind: "money" },
      ],
      rows,
      note:
        "Advance applied is prepaid cash being consumed, not a new payment — only Settlement cash paid left the company at settlement time. The Payments report counts each exactly once.",
      isEmpty: scoped.length === 0,
      hasAnyData: cost.length > 0,
    };
  },
};

export const CONTRACTOR_REPORTS: ReportDef[] = [contractorPosition, contractorSettlements];
