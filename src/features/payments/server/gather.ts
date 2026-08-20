"use server";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { paymentsVisibilityFor, seesAllProjects } from "../visibility";
import type {
  RawAgreementPayment,
  RawLedgerEntry,
  RawPaymentsData,
  RawSettlement,
  RawVendorPayment,
} from "../types";

/**
 * Read every cash instrument for this company, scoped to the caller.
 *
 * Scoping happens in the WHERE clauses, so a row outside the caller's projects
 * is never loaded. Each source is one query and they run in parallel — there is
 * no per-transaction lookup anywhere in this file.
 */
export async function gatherServerPayments(opts: {
  from: string | null;
  to: string | null;
}): Promise<RawPaymentsData> {
  const { from, to } = opts;
  const user = await requireUser();
  const companyId = user.company.id;
  const today = new Date().toISOString().slice(0, 10);
  const visibility = paymentsVisibilityFor(user);

  // Owners and holders of a cross-project view see every project; everyone else
  // sees only the projects they manage.
  const allProjects = seesAllProjects(user);
  const projectScope = allProjects ? {} : { project: { pmId: user.id } };
  /**
   * A company-wide advance has projectId NULL, so it is not reachable by any
   * project filter — it is admitted or excluded on its own permission. Written
   * out as one expression so the four combinations stay visible.
   */
  const advanceScope = visibility.companyWideAdvances
    ? allProjects
      ? {}
      : { OR: [{ projectId: null }, { project: { pmId: user.id } }] }
    : allProjects
      ? { projectId: { not: null } }
      : { projectId: { not: null }, project: { pmId: user.id } };

  /**
   * The period, pushed into the QUERY rather than applied after the fact.
   * Payment history grows without bound, so a lifetime fetch would send more
   * data every year the company operates; bounding here keeps the common case
   * (one month) the same size regardless of company age.
   */
  const dateScope =
    from || to
      ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
      : {};
  // A settlement is dated by the period it settles to, not by `date`.
  const settlementDateScope =
    from || to
      ? {
          periodEnd: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {};

  const [ledgerRows, settlementRows, agreementRows, vendorRows, everCount] = await Promise.all([
    visibility.contractorLedger
      ? prisma.contractorLedgerEntry.findMany({
          where: {
            companyId,
            // Only the CASH types. The drawdowns, transfers, bills and reversal
            // rows are internal reallocation and never leave this query.
            type: { in: ["ADVANCE", "OPENING_ADVANCE"] },
            ...advanceScope,
            ...dateScope,
          },
          select: {
            id: true,
            contractorId: true,
            date: true,
            type: true,
            amountPaise: true,
            notes: true,
            projectId: true,
            contractId: true,
            settlementId: true,
            contractor: { select: { name: true } },
            project: { select: { name: true, code: true } },
            contract: { select: { title: true } },
          },
        })
      : Promise.resolve([]),
    visibility.contractorLedger
      ? prisma.contractorSettlement.findMany({
          where: { companyId, ...projectScope, ...settlementDateScope },
          select: {
            id: true,
            contractorId: true,
            projectId: true,
            periodStart: true,
            periodEnd: true,
            labourBillPaise: true,
            advanceAdjustmentPaise: true,
            netPaymentPaise: true,
            notes: true,
            reversedAt: true,
            reversalReason: true,
            contractor: { select: { name: true } },
            project: { select: { name: true, code: true } },
          },
        })
      : Promise.resolve([]),
    visibility.agreementPayments
      ? prisma.contractorContractPayment.findMany({
          where: { companyId, ...projectScope, ...dateScope },
          select: {
            id: true,
            contractId: true,
            contractorId: true,
            projectId: true,
            amountPaise: true,
            type: true,
            paymentMode: true,
            referenceNumber: true,
            date: true,
            notes: true,
            deletedAt: true,
            reversalReason: true,
            contract: { select: { title: true } },
            contractor: { select: { name: true } },
            project: { select: { name: true, code: true } },
          },
        })
      : Promise.resolve([]),
    visibility.vendorPayments
      ? prisma.vendorPayment.findMany({
          where: { companyId, ...projectScope, ...dateScope },
          select: {
            id: true,
            vendorId: true,
            projectId: true,
            purchaseOrderId: true,
            amountPaise: true,
            paymentMode: true,
            referenceNumber: true,
            date: true,
            remarks: true,
            vendor: { select: { businessName: true } },
            project: { select: { name: true, code: true } },
            purchaseOrder: { select: { poNumber: true } },
          },
        })
      : Promise.resolve([]),
    /**
     * Has this company EVER recorded a payment the caller may see?
     *
     * One indexed count, unbounded by period, so a quiet month and a brand-new
     * company can be told apart. `take: 1` because only existence matters —
     * counting a decade of rows to answer a yes/no would be its own defect.
     */
    (async () => {
      const probes = await Promise.all([
        visibility.contractorLedger
          ? prisma.contractorLedgerEntry.findMany({
              where: { companyId, type: { in: ["ADVANCE", "OPENING_ADVANCE"] }, ...advanceScope },
              select: { id: true },
              take: 1,
            })
          : Promise.resolve([]),
        visibility.contractorLedger
          ? prisma.contractorSettlement.findMany({
              where: { companyId, ...projectScope },
              select: { id: true },
              take: 1,
            })
          : Promise.resolve([]),
        visibility.agreementPayments
          ? prisma.contractorContractPayment.findMany({
              where: { companyId, ...projectScope },
              select: { id: true },
              take: 1,
            })
          : Promise.resolve([]),
        visibility.vendorPayments
          ? prisma.vendorPayment.findMany({
              where: { companyId, ...projectScope },
              select: { id: true },
              take: 1,
            })
          : Promise.resolve([]),
      ]);
      return probes.some((rows) => rows.length > 0);
    })(),
  ]);

  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  const ledger: RawLedgerEntry[] = ledgerRows.map((e) => ({
    id: e.id,
    contractorId: e.contractorId,
    contractorName: e.contractor.name,
    date: ymd(e.date),
    type: e.type,
    amountPaise: Number(e.amountPaise),
    notes: e.notes,
    projectId: e.projectId,
    projectName: e.project?.name ?? null,
    projectCode: e.project?.code ?? null,
    contractId: e.contractId,
    contractTitle: e.contract?.title ?? null,
    settlementId: e.settlementId,
  }));

  const settlements: RawSettlement[] = settlementRows.map((s) => ({
    id: s.id,
    contractorId: s.contractorId,
    contractorName: s.contractor.name,
    projectId: s.projectId,
    projectName: s.project.name,
    projectCode: s.project.code,
    periodStart: ymd(s.periodStart),
    periodEnd: ymd(s.periodEnd),
    labourBillPaise: Number(s.labourBillPaise),
    advanceAdjustmentPaise: Number(s.advanceAdjustmentPaise),
    netPaymentPaise: Number(s.netPaymentPaise),
    notes: s.notes,
    reversedAt: s.reversedAt ? s.reversedAt.toISOString() : null,
    reversalReason: s.reversalReason,
  }));

  const agreementPayments: RawAgreementPayment[] = agreementRows.map((p) => ({
    id: p.id,
    contractId: p.contractId,
    contractTitle: p.contract.title,
    contractorId: p.contractorId,
    contractorName: p.contractor.name,
    projectId: p.projectId,
    projectName: p.project.name,
    projectCode: p.project.code,
    amountPaise: Number(p.amountPaise),
    type: p.type,
    paymentMode: p.paymentMode,
    referenceNumber: p.referenceNumber,
    date: ymd(p.date),
    notes: p.notes,
    // Soft-delete IS the reversal for an agreement payment.
    reversedAt: p.deletedAt ? p.deletedAt.toISOString() : null,
    reversalReason: p.reversalReason,
  }));

  const vendorPayments: RawVendorPayment[] = vendorRows.map((p) => ({
    id: p.id,
    vendorId: p.vendorId,
    vendorName: p.vendor.businessName,
    projectId: p.projectId,
    projectName: p.project.name,
    projectCode: p.project.code,
    purchaseOrderId: p.purchaseOrderId,
    poNumber: p.purchaseOrder?.poNumber ?? null,
    amountPaise: Number(p.amountPaise),
    paymentMode: p.paymentMode,
    referenceNumber: p.referenceNumber,
    date: ymd(p.date),
    remarks: p.remarks,
  }));

  return {
    ledger,
    settlements,
    agreementPayments,
    vendorPayments,
    visibility,
    hasAnyPayments: everCount,
    from,
    to,
    today,
  };
}
