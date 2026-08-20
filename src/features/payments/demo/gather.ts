import { demoContractorCashSources } from "@/features/contractors/demo/demo-repository";
import { demoAgreementCashSources } from "@/features/contracts/demo/demo-repository";
import { demoProcurementRepository } from "@/features/procurement/demo/demo-repository";
import { demoSeed as demoProjectSeed } from "@/features/projects/demo/seed";
import type {
  PaymentsVisibility,
  RawAgreementPayment,
  RawLedgerEntry,
  RawPaymentsData,
  RawSettlement,
  RawVendorPayment,
} from "../types";

const PROJECTS = "constructly.demo.projects.v1";

interface StoredProject {
  id: string;
  name: string;
  code: string;
  pm: { id: string } | null;
}

/**
 * Read the demo project store, SEEDING it if it does not exist yet — the same
 * fix the dashboard gatherer needed. Without it, a fresh session has no project
 * store, every payment fails project scoping, and the Payments Centre reports
 * an empty company that is not empty.
 */
function readProjects(): StoredProject[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PROJECTS);
    if (raw != null) return JSON.parse(raw) as StoredProject[];
  } catch {
    return [];
  }
  const seeded = structuredClone(demoProjectSeed()) as StoredProject[];
  try {
    window.localStorage.setItem(PROJECTS, JSON.stringify(seeded));
  } catch {
    /* storage unavailable — the read still returns the data */
  }
  return seeded;
}

/**
 * Assemble the raw payment sources from the demo stores.
 *
 * Project scoping is applied HERE, before assembly, exactly as the server does:
 * a row outside the caller's projects is never returned, rather than returned
 * and hidden in React.
 */
export async function gatherDemoPayments(opts: {
  userId: string;
  isOwner: boolean;
  visibility: PaymentsVisibility;
  from: string | null;
  to: string | null;
}): Promise<RawPaymentsData> {
  const today = new Date().toISOString().slice(0, 10);
  const { visibility, from, to } = opts;
  /** Inclusive on both ends; a null bound simply does not constrain. */
  const inPeriod = (d: string) => (!from || d >= from) && (!to || d <= to);

  let projects = readProjects();
  if (!opts.isOwner) projects = projects.filter((p) => p.pm?.id === opts.userId);
  const proj = new Map(projects.map((p) => [p.id, { name: p.name, code: p.code }]));
  const inScope = (id: string | null | undefined) => id != null && proj.has(id);

  let anyCash = false;
  let ledger: RawLedgerEntry[] = [];
  let settlements: RawSettlement[] = [];
  if (visibility.contractorLedger) {
    const src = demoContractorCashSources();
    const nameOf = new Map(src.contractors.map((c) => [c.id, c.name]));
    // Counted before the period filter: "this month was quiet" and "this
    // company has never paid anyone" must not look the same.
    anyCash =
      anyCash ||
      src.ledger.some((e) => e.type === "ADVANCE" || e.type === "OPENING_ADVANCE") ||
      src.settlements.length > 0;
    ledger = src.ledger
      // A company-wide advance has no project to scope by; `assemblePayments`
      // applies the ledger's own view_all rule to it.
      .filter((e) => (e.projectId == null ? visibility.companyWideAdvances : inScope(e.projectId)))
      .filter((e) => inPeriod(e.date))
      .map((e) => ({
        id: e.id,
        contractorId: e.contractorId,
        contractorName: nameOf.get(e.contractorId) ?? "Contractor",
        date: e.date,
        type: e.type,
        amountPaise: e.amountPaise,
        notes: e.notes,
        projectId: e.projectId,
        projectName: e.projectId ? (proj.get(e.projectId)?.name ?? e.projectName) : null,
        projectCode: e.projectId ? (proj.get(e.projectId)?.code ?? null) : null,
        contractId: e.contractId,
        contractTitle: e.contractTitle,
        settlementId: e.settlementId,
      }));
    settlements = src.settlements
      .filter((s) => inScope(s.projectId))
      // A settlement is dated by the period it settles to.
      .filter((s) => inPeriod(s.periodEnd))
      .map((s) => ({
        id: s.id,
        contractorId: s.contractorId,
        contractorName: nameOf.get(s.contractorId) ?? s.contractorName,
        projectId: s.projectId,
        projectName: proj.get(s.projectId)?.name ?? s.projectName,
        projectCode: proj.get(s.projectId)?.code ?? null,
        periodStart: s.periodStart,
        periodEnd: s.periodEnd,
        labourBillPaise: s.labourBillPaise,
        advanceAdjustmentPaise: s.advanceAdjustmentPaise,
        netPaymentPaise: s.netPaymentPaise,
        notes: s.notes,
        reversedAt: s.reversedAt ?? null,
        reversalReason: s.reversalReason ?? null,
      }));
  }

  let agreementPayments: RawAgreementPayment[] = [];
  if (visibility.agreementPayments) {
    const src = demoAgreementCashSources();
    const titleOf = new Map(src.contracts.map((c) => [c.id, c.title]));
    const nameOf = new Map(demoContractorCashSources().contractors.map((c) => [c.id, c.name]));
    anyCash = anyCash || src.payments.length > 0;
    agreementPayments = src.payments
      .filter((p) => inScope(p.projectId))
      .filter((p) => inPeriod(p.date))
      .map((p) => ({
        id: p.id,
        contractId: p.contractId,
        contractTitle: titleOf.get(p.contractId) ?? "Agreement",
        contractorId: p.contractorId,
        contractorName: nameOf.get(p.contractorId) ?? "Contractor",
        projectId: p.projectId,
        projectName: proj.get(p.projectId)?.name ?? "",
        projectCode: proj.get(p.projectId)?.code ?? null,
        amountPaise: p.amountPaise,
        type: p.type,
        paymentMode: p.paymentMode,
        referenceNumber: p.referenceNumber,
        date: p.date,
        notes: p.notes,
        // Soft-delete IS the reversal for an agreement payment.
        reversedAt: p.deletedAt,
        reversalReason: p.reversalReason,
      }));
  }

  let vendorPayments: RawVendorPayment[] = [];
  if (visibility.vendorPayments) {
    const rows = await demoProcurementRepository.listPayments({});
    anyCash = anyCash || rows.length > 0;
    vendorPayments = rows
      .filter((p) => inScope(p.project.id))
      .filter((p) => inPeriod(p.date))
      .map((p) => ({
        id: p.id,
        vendorId: p.vendor.id,
        vendorName: p.vendor.name,
        projectId: p.project.id,
        projectName: p.project.name,
        projectCode: p.project.code,
        purchaseOrderId: p.purchaseOrder?.id ?? null,
        poNumber: p.purchaseOrder?.poNumber ?? null,
        amountPaise: p.amountPaise,
        paymentMode: p.paymentMode,
        referenceNumber: p.referenceNumber,
        date: p.date,
        remarks: p.remarks,
      }));
  }

  return {
    ledger,
    settlements,
    agreementPayments,
    vendorPayments,
    visibility,
    hasAnyPayments: anyCash,
    from,
    to,
    today,
  };
}
