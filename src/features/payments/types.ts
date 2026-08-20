/**
 * The global Payments Centre read model.
 *
 * Constructly records money in several different places, and they do not mean
 * the same thing. The point of this module is to give one place to FIND a
 * financial transaction without flattening that difference away:
 *
 *   CASH MOVEMENT        money actually left the company
 *   INTERNAL ALLOCATION  money already paid being re-attributed
 *   REVERSAL/CORRECTION  an earlier record being undone
 *
 * Only CASH MOVEMENT becomes a transaction here. An advance drawdown, a scope
 * transfer and an attribution correction all carry a rupee amount, and none of
 * them is a payment — showing them beside real payments would inflate what the
 * company believes it paid.
 *
 * This is a READ MODEL. Nothing in it is persisted and it adds no schema: it is
 * assembled from ContractorLedgerEntry, ContractorSettlement,
 * ContractorContractPayment and VendorPayment, each of which remains the
 * canonical record for its own instrument.
 */

import type { PaymentMode } from "@/features/procurement/types";

export type { PaymentMode };

/**
 * The user-facing instrument vocabulary. Deliberately not the raw enums: a user
 * reading "OPENING_ADVANCE" learns nothing that "Contractor advance" does not
 * say better.
 */
export type PaymentTransactionType =
  /** Prepaid labour cash handed to a contractor (ledger ADVANCE / OPENING_ADVANCE). */
  | "CONTRACTOR_ADVANCE"
  /** Commercial payment against an agreement (ContractorContractPayment). */
  | "CONTRACTOR_PAYMENT"
  /** The NET cash a weekly settlement paid out (ContractorSettlement). */
  | "LABOUR_SETTLEMENT"
  /** Payment to a vendor, against a PO or on account (VendorPayment). */
  | "VENDOR_PAYMENT";

export type PaymentPartyType = "CONTRACTOR" | "VENDOR";

/**
 * ACTIVE is ordinary financial history, not an achievement — it is presented
 * neutrally. REVERSED is the only state that must stand out, because the money
 * it describes is no longer counted anywhere.
 */
export type PaymentStatus = "ACTIVE" | "REVERSED";

/** What kind of record this transaction was read from. */
export type PaymentSourceKind =
  | "ADVANCE_LEDGER"
  | "AGREEMENT"
  | "SETTLEMENT"
  | "PURCHASE_ORDER"
  | "VENDOR";

/**
 * One line of settlement/agreement context. NEVER a second transaction: these
 * amounts explain the payment beside them and are excluded from every total
 * this module computes.
 */
export interface PaymentContextLine {
  label: string;
  amountPaise: number;
  /** Plain-words reason this is not itself a payment. */
  note?: string;
}

export interface PaymentTransaction {
  /**
   * Namespaced by instrument (advance:<id>, settlement:<id>, …) because the
   * underlying ids come from four different tables and only need to be unique
   * within this list.
   */
  id: string;
  type: PaymentTransactionType;
  /** YYYY-MM-DD. The date the money moved, not the date it was keyed in. */
  date: string;
  /** Cash that moved. Always positive; direction is implied by the instrument. */
  amountPaise: number;

  party: {
    type: PaymentPartyType;
    id: string;
    name: string;
    /** Canonical party record, where one exists. */
    href: string | null;
  };

  /** Null only where the instrument genuinely has no project. */
  project: { id: string; name: string; code: string | null } | null;
  /**
   * What the money was for when a project alone does not say it — an agreement
   * title, or the plain statement that a company-wide advance has no project.
   * Never a stand-in project name.
   */
  scopeLabel: string | null;

  /** Where to go to see, correct or audit this transaction. */
  source: { kind: PaymentSourceKind; id: string; href: string; label: string };

  /** Null where the domain does not record one. */
  paymentMode: PaymentMode | null;
  reference: string | null;

  status: PaymentStatus;
  reversedAt: string | null;
  reversalReason: string | null;

  description: string | null;
  context: PaymentContextLine[];
}

/* ── Raw inputs ───────────────────────────────────────────────────────── */

/** A contractor ledger entry, narrowed to what this module reads. */
export interface RawLedgerEntry {
  id: string;
  contractorId: string;
  contractorName: string;
  date: string;
  type: string;
  amountPaise: number;
  notes: string | null;
  projectId: string | null;
  projectName: string | null;
  projectCode: string | null;
  contractId: string | null;
  contractTitle: string | null;
  settlementId: string | null;
}

export interface RawSettlement {
  id: string;
  contractorId: string;
  contractorName: string;
  projectId: string;
  projectName: string;
  projectCode: string | null;
  periodStart: string;
  periodEnd: string;
  labourBillPaise: number;
  advanceAdjustmentPaise: number;
  netPaymentPaise: number;
  notes: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
}

export interface RawAgreementPayment {
  id: string;
  contractId: string;
  contractTitle: string;
  contractorId: string;
  contractorName: string;
  projectId: string;
  projectName: string;
  projectCode: string | null;
  amountPaise: number;
  type: string;
  paymentMode: PaymentMode;
  referenceNumber: string | null;
  date: string;
  notes: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
}

export interface RawVendorPayment {
  id: string;
  vendorId: string;
  vendorName: string;
  projectId: string;
  projectName: string;
  projectCode: string | null;
  purchaseOrderId: string | null;
  poNumber: string | null;
  amountPaise: number;
  paymentMode: PaymentMode;
  referenceNumber: string | null;
  date: string;
  remarks: string | null;
}

/**
 * What the caller may see, resolved BEFORE any row is read. A false flag means
 * the corresponding source query never runs — nothing is fetched and then
 * filtered in the browser.
 */
export interface PaymentsVisibility {
  vendorPayments: boolean;
  agreementPayments: boolean;
  contractorLedger: boolean;
  /**
   * Company-wide advances carry no project, so project scoping cannot contain
   * them. They follow the existing ledger rule: `contractors.view_all` only.
   */
  companyWideAdvances: boolean;
}

export interface RawPaymentsData {
  ledger: RawLedgerEntry[];
  settlements: RawSettlement[];
  agreementPayments: RawAgreementPayment[];
  vendorPayments: RawVendorPayment[];
  visibility: PaymentsVisibility;
  /**
   * Has this company EVER recorded a payment, in any period?
   *
   * Separate from "this period is empty", and the difference is the whole
   * empty-state decision: a new company needs an explanation of where payments
   * come from, while an established one looking at a quiet month needs to be
   * told to widen the period — not that it has no payments.
   */
  hasAnyPayments: boolean;
  /** The period these rows were read for. Null bounds mean unbounded. */
  from: string | null;
  to: string | null;
  /** YYYY-MM-DD for the viewer's today. */
  today: string;
}

/* ── Filters & period ─────────────────────────────────────────────────── */

export type PeriodPreset =
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "LAST_90"
  | "FINANCIAL_YEAR"
  | "ALL_TIME"
  | "CUSTOM";

export interface PaymentPeriod {
  preset: PeriodPreset;
  /** Inclusive YYYY-MM-DD. Null on ALL_TIME — unbounded, and stated as such. */
  from: string | null;
  to: string | null;
  /** Always rendered beside a headline figure. A total with no period is a lie. */
  label: string;
}

export interface PaymentsFilters {
  search?: string;
  type?: PaymentTransactionType | "ALL";
  partyType?: PaymentPartyType | "ALL";
  projectId?: string | "ALL";
  status?: PaymentStatus | "ALL";
  mode?: PaymentMode | "ALL";
}

/* ── Summary ──────────────────────────────────────────────────────────── */

export interface PaymentTypeTotal {
  type: PaymentTransactionType;
  amountPaise: number;
  count: number;
}

/**
 * Movement totals for a period.
 *
 * `paidPaise` counts ACTIVE cash only. Reversed value is reported separately and
 * never nets against it — summing a payment and its own reversal into one
 * number would state a movement that never happened.
 */
export interface PaymentsSummary {
  period: PaymentPeriod;
  paidPaise: number;
  paidCount: number;
  contractorPaidPaise: number;
  contractorPaidCount: number;
  vendorPaidPaise: number;
  vendorPaidCount: number;
  reversedPaise: number;
  reversedCount: number;
  byType: PaymentTypeTotal[];
}

export interface PaymentsSnapshot {
  /** Every visible cash transaction in the requested period, newest first. */
  transactions: PaymentTransaction[];
  /** No transactions in THIS period. Says nothing about the company overall. */
  isEmpty: boolean;
  /** The company has never recorded a payment. The genuine onboarding case. */
  hasAnyPayments: boolean;
  /** Echoed back so a rendered total can never be labelled with the wrong period. */
  from: string | null;
  to: string | null;
  visibility: PaymentsVisibility;
  today: string;
}
