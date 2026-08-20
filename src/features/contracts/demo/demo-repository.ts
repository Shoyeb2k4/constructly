/**
 * Demo-mode agreements store (localStorage).
 *
 * Every commercial number is produced by the SAME pure engine the server uses —
 * reconcile / rates / milestones. Nothing is recomputed locally. That is what
 * makes demo mode a genuine rehearsal rather than a lookalike, and it means the
 * repository tests exercise the production engine end to end.
 *
 * The seed is the brief's authoritative acceptance case, stated in rupees and
 * converted through the shared fixtures so it can never silently run at a
 * fraction of its value.
 */

import { reconcileAgreement, reconciliationTimeline, rollUpReconciliations, validateCreditCeiling } from "../reconcile";
import { validateRevisedValue } from "../amendments";
import { effectiveRateOn, rateBands, rateRevisionBlockedReason, validateRateRevision } from "../rates";
import { buildAttributionPreview, findCollisions, type AttributionRow } from "../attribution";
import { newBusinessBlockedReason } from "@/features/contractors/lifecycle";
import { bucketAttendance, sumPositions } from "../attendance-position";
import type { ContractorStatus } from "@/features/contractors/types";
import {
  canSettleAgreement,
  canTransitionAgreement,
  completedValuePaise,
  cumulativeEarnedThroughPaise,
  milestoneCurrentCoverageState,
  milestoneFinancialStateAtCompletion,
  validateMilestoneCompletion,
  validateMilestoneTransition,
} from "../milestones";
import { RS_2L, RS_3L, RS_6L, RS_8L, RS_10L, RS_40L, RS_60L, lakhs } from "../__fixtures__/amounts";
import type { ContractsRepository } from "../repository";
import type {
  AgreementDetail,
  AgreementSnapshot,
  Amendment,
  AmendmentStatus,
  AmendmentType,
  Contract,
  ContractFilters,
  ContractPayment,
  ContractPaymentHistoryRow,
  HistoryEvent,
  ContractStatus,
  Milestone,
  MilestoneStatus,
  ProjectAgreementsGroup,
  ProjectContractorSummaryRow,
  RateRevision,
  ScopeItem,
  ContractorProjectAttendance,
  PaymentMode,
} from "../types";

/* ── Storage ────────────────────────────────────────────────────────────── */

const K = {
  contracts: "constructly.demo.contractorContracts.v2",
  payments: "constructly.demo.contractorContractPayments.v2",
  scopeItems: "constructly.demo.contractScopeItems.v1",
  scopeRates: "constructly.demo.contractScopeRates.v1",
  milestones: "constructly.demo.contractMilestones.v1",
  amendments: "constructly.demo.contractAmendments.v1",
  /**
   * APPEND-ONLY demo audit events.
   *
   * Demo History is otherwise DERIVED from current state — it walks agreements,
   * milestones and payments and reconstructs what must have happened. An
   * attribution correction leaves no trace in current state (the row simply has
   * a different contractId), so it would be invisible and un-reversible in demo
   * without somewhere to record it. Deliberately narrow: only these corrections
   * are written here, and nothing existing was migrated into it.
   */
  events: "constructly.demo.activityLog.v1",
};
/** v1 keys, read once during migration then removed. */
const LEGACY = {
  contracts: "constructly.demo.contractorContracts.v1",
  payments: "constructly.demo.contractorContractPayments.v1",
};
const CONTRACTORS = "constructly.demo.contractors.v1";
const PROJECTS = "constructly.demo.projects.v1";
/** Owned by the contractors module; read-only here, for the History feed. */
const SETTLEMENTS = "constructly.demo.contractorSettlements.v1";
/** Owned by the labour module; read-only here, for agreement attendance credit. */
const LABOUR_ATTENDANCE = "constructly.demo.labourAttendance.v2";

const PROJECT_A = "10000000-0000-0000-0000-000000000001";
const ORION = "10000000-0000-0000-0000-000000000002";
const PAPPU = "c-pappu";
const SURESH = "c-suresh";

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const nowISO = () => new Date().toISOString();
const todayISO = () => nowISO().slice(0, 10);

type ContractRec = {
  id: string;
  contractorId: string;
  projectId: string;
  title: string;
  reference: string | null;
  scope: string | null;
  quantity: number | null;
  unit: string | null;
  originalAmountPaise: number;
  currentAmountPaise: number;
  startDate: string | null;
  expectedCompletionDate: string | null;
  status: ContractStatus;
  notes: string | null;
  completedAt: string | null;
  settledAt: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  createdAt: string;
  deletedAt: string | null;
};

type PaymentRec = {
  id: string;
  contractId: string;
  contractorId: string;
  projectId: string;
  amountPaise: number;
  type: ContractPayment["type"];
  paymentMode: ContractPayment["paymentMode"];
  referenceNumber: string | null;
  date: string;
  notes: string | null;
  milestoneId: string | null;
  clientUuid: string | null;
  createdAt: string;
  deletedAt: string | null;
  reversalReason: string | null;
};

type ScopeItemRec = {
  id: string;
  contractId: string;
  labourSubcategoryId: string;
  subcategoryName: string;
  categoryId: string;
  categoryName: string;
  currentRatePaise: number;
  rateUnit: string;
  notes: string | null;
  createdAt: string;
  deletedAt: string | null;
};

type RateRec = {
  id: string;
  scopeItemId: string;
  contractId: string;
  ratePaise: number;
  rateUnit: string;
  effectiveFrom: string;
  reason: string | null;
  createdByName: string | null;
  createdAt: string;
};

type MilestoneRec = {
  id: string;
  contractId: string;
  sequence: number;
  title: string;
  description: string | null;
  valuePaise: number;
  plannedDate: string | null;
  status: MilestoneStatus;
  completedAt: string | null;
  completedByName: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  notes: string | null;
  createdAt: string;
  deletedAt: string | null;
};

type AmendmentRec = {
  id: string;
  contractId: string;
  sequence: number;
  type: AmendmentType;
  previousAmountPaise: number;
  revisedAmountPaise: number;
  deltaPaise: number;
  reason: string;
  effectiveDate: string;
  status: AmendmentStatus;
  requestedByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  createdAt: string;
  deletedAt: string | null;
};

/* ── Seed: the authoritative acceptance case ────────────────────────────── */

const STRUCTURE = "ag-structure";
const COMPOUND_WALL = "ag-compound-wall";
const FINISHING = "ag-finishing";
const ORION_AGREEMENT = "ag-orion";

const agreement = (over: Partial<ContractRec> & Pick<ContractRec, "id" | "title" | "originalAmountPaise">): ContractRec => ({
  contractorId: PAPPU,
  projectId: PROJECT_A,
  reference: null,
  scope: null,
  quantity: null,
  unit: null,
  currentAmountPaise: over.originalAmountPaise,
  startDate: "2026-01-10",
  expectedCompletionDate: null,
  status: "IN_PROGRESS",
  notes: null,
  completedAt: null,
  settledAt: null,
  cancelledAt: null,
  cancelledReason: null,
  createdAt: "2026-01-10T00:00:00.000Z",
  deletedAt: null,
  ...over,
});

const SEED_CONTRACTS: ContractRec[] = [
  // Pappu Contractor → Project A → Structure: ₹60,00,000 over six ₹10,00,000
  // slabs. Slab 1 complete, ₹6,00,000 of settled attendance and ₹2,00,000 of
  // payments ⇒ earned ₹10,00,000, credited ₹8,00,000, DUE ₹2,00,000.
  agreement({
    id: STRUCTURE,
    title: "Structure",
    reference: "AGR-2026-001",
    scope: "Complete RCC / structural work for the main building",
    quantity: 6,
    unit: "Slabs",
    originalAmountPaise: RS_60L,
  }),
  // A SECOND agreement for the same contractor on the same project, carrying an
  // advance. Its ₹3,00,000 ahead credit must never offset Structure's due.
  agreement({
    id: COMPOUND_WALL,
    title: "Compound Wall",
    reference: "AGR-2026-002",
    scope: "Boundary wall and gate",
    originalAmountPaise: lakhs(8),
    status: "NOT_STARTED",
    createdAt: "2026-02-01T00:00:00.000Z",
    startDate: "2026-02-01",
  }),
  // Unequal milestone values, plus an approved and a proposed amendment.
  agreement({
    id: FINISHING,
    title: "Interior Finishing",
    scope: "Plaster, flooring and painting",
    originalAmountPaise: lakhs(60),
    currentAmountPaise: lakhs(65), // after the approved variation below
    status: "IN_PROGRESS",
    createdAt: "2026-03-01T00:00:00.000Z",
    startDate: "2026-03-01",
  }),
  // Cross-project isolation: same contractor, different project.
  agreement({
    id: ORION_AGREEMENT,
    title: "Orion Structure",
    projectId: ORION,
    originalAmountPaise: lakhs(25),
    createdAt: "2026-04-01T00:00:00.000Z",
    startDate: "2026-04-01",
  }),
];

const SEED_MILESTONES: MilestoneRec[] = [
  ...[1, 2, 3, 4, 5, 6].map((n) => ({
    id: `ms-slab-${n}`,
    contractId: STRUCTURE,
    sequence: n - 1,
    title: `Slab ${n}`,
    description: null,
    valuePaise: RS_10L,
    plannedDate: null,
    // Only Slab 1 is complete — the acceptance case's starting position.
    status: (n === 1 ? "COMPLETED" : n === 2 ? "IN_PROGRESS" : "NOT_STARTED") as MilestoneStatus,
    completedAt: n === 1 ? "2026-02-15T00:00:00.000Z" : null,
    completedByName: n === 1 ? "Aarav Mehta" : null,
    cancelledAt: null,
    cancelledReason: null,
    notes: null,
    createdAt: "2026-01-10T00:00:00.000Z",
    deletedAt: null,
  })),
  {
    id: "ms-wall",
    contractId: COMPOUND_WALL,
    sequence: 0,
    title: "Wall complete",
    description: null,
    valuePaise: lakhs(8),
    plannedDate: null,
    status: "NOT_STARTED",
    completedAt: null,
    completedByName: null,
    cancelledAt: null,
    cancelledReason: null,
    notes: null,
    createdAt: "2026-02-01T00:00:00.000Z",
    deletedAt: null,
  },
  // Deliberately unequal values.
  ...[
    { key: "mobilisation", title: "Mobilisation", value: lakhs(5), done: true },
    { key: "plaster", title: "Plaster", value: lakhs(15), done: true },
    { key: "flooring", title: "Flooring", value: RS_40L, done: false },
    { key: "painting", title: "Painting", value: lakhs(5), done: false },
  ].map((m, i) => ({
    id: `ms-${m.key}`,
    contractId: FINISHING,
    sequence: i,
    title: m.title,
    description: null,
    valuePaise: m.value,
    plannedDate: null,
    status: (m.done ? "COMPLETED" : "NOT_STARTED") as MilestoneStatus,
    completedAt: m.done ? "2026-04-10T00:00:00.000Z" : null,
    completedByName: m.done ? "Aarav Mehta" : null,
    cancelledAt: null,
    cancelledReason: null,
    notes: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    deletedAt: null,
  })),
];

const payment = (
  id: string,
  contractId: string,
  projectId: string,
  amountPaise: number,
  type: PaymentRec["type"],
  date: string,
  over: Partial<PaymentRec> = {},
): PaymentRec => ({
  id,
  contractId,
  contractorId: PAPPU,
  projectId,
  amountPaise,
  type,
  paymentMode: "BANK_TRANSFER",
  referenceNumber: null,
  date,
  notes: null,
  milestoneId: null,
  clientUuid: null,
  createdAt: `${date}T00:00:00.000Z`,
  deletedAt: null,
  reversalReason: null,
  ...over,
});

const SEED_PAYMENTS: PaymentRec[] = [
  payment("pay-structure-1", STRUCTURE, PROJECT_A, RS_2L, "INTERIM", "2026-02-12"),
  // A reversed payment, so the struck-through state has a worked example.
  payment("pay-structure-rev", STRUCTURE, PROJECT_A, lakhs(1), "INTERIM", "2026-02-18", {
    deletedAt: "2026-02-19T00:00:00.000Z",
    reversalReason: "Duplicate entry — paid twice by mistake",
  }),
  payment("pay-wall-adv", COMPOUND_WALL, PROJECT_A, RS_3L, "ADVANCE", "2026-02-05"),
  payment("pay-finishing-1", FINISHING, PROJECT_A, lakhs(18), "INTERIM", "2026-04-15"),
  payment("pay-orion-1", ORION_AGREEMENT, ORION, lakhs(4), "ADVANCE", "2026-04-05"),
];

/**
 * Scope items point at the SAME labour subcategory ids the labour module seeds.
 * They have to: the daily attendance sheet renders an agreement's scope as the
 * labour types you can record against, so a scope item naming a type that
 * doesn't exist would be a row nobody could ever fill in.
 */
const SUB = {
  mainCarpenter: "65000000-0000-0000-0000-000000000001",
  mason: "65000000-0000-0000-0000-000000000005",
  masonHelper: "65000000-0000-0000-0000-000000000006",
  painter: "65000000-0000-0000-0000-000000000007",
};
const CAT = {
  carpenter: { id: "6c000000-0000-0000-0000-000000000001", name: "Carpenter" },
  mason: { id: "6c000000-0000-0000-0000-000000000003", name: "Mason" },
  painter: { id: "6c000000-0000-0000-0000-000000000004", name: "Painter" },
};

const scopeItem = (
  id: string,
  contractId: string,
  subcategoryId: string,
  subcategoryName: string,
  category: { id: string; name: string },
  currentRatePaise: number,
  createdAt = "2026-01-10T00:00:00.000Z",
): ScopeItemRec => ({
  id,
  contractId,
  labourSubcategoryId: subcategoryId,
  subcategoryName,
  categoryId: category.id,
  categoryName: category.name,
  currentRatePaise,
  rateUnit: "day",
  notes: null,
  createdAt,
  deletedAt: null,
});

const SEED_SCOPE_ITEMS: ScopeItemRec[] = [
  scopeItem("si-mason", STRUCTURE, SUB.mason, "Mason", CAT.mason, 90_000),
  scopeItem("si-mason-helper", STRUCTURE, SUB.masonHelper, "Mason Helper", CAT.mason, 60_000),
  scopeItem("si-carpenter", STRUCTURE, SUB.mainCarpenter, "Main Carpenter", CAT.carpenter, 65_000),
  // Compound Wall shares MASON with Structure. That overlap is the point: on any
  // given day Pappu's masons might be on the tower or on the boundary wall, and
  // only the person recording attendance knows which — so the system asks.
  scopeItem("si-wall-mason", COMPOUND_WALL, SUB.mason, "Mason", CAT.mason, 80_000, "2026-02-01T00:00:00.000Z"),
  scopeItem("si-wall-painter", COMPOUND_WALL, SUB.painter, "Painter", CAT.painter, 70_000, "2026-02-01T00:00:00.000Z"),
  // Orion: Pappu's ONLY agreement on that project, so it auto-selects.
  scopeItem("si-orion-mason", ORION_AGREEMENT, SUB.mason, "Mason", CAT.mason, 95_000, "2026-04-01T00:00:00.000Z"),
];

/** Mason carries two revisions, so the rate-history timeline has real content. */
const SEED_RATES: RateRec[] = [
  {
    id: "rate-mason-1",
    scopeItemId: "si-mason",
    contractId: STRUCTURE,
    ratePaise: 85_000,
    rateUnit: "day",
    effectiveFrom: "2026-01-10",
    reason: "Original agreement",
    createdByName: "Aarav Mehta",
    createdAt: "2026-01-10T00:00:00.000Z",
  },
  {
    id: "rate-mason-2",
    scopeItemId: "si-mason",
    contractId: STRUCTURE,
    ratePaise: 90_000,
    rateUnit: "day",
    effectiveFrom: "2026-04-01",
    reason: "Rate revision — project duration extension",
    createdByName: "Aarav Mehta",
    createdAt: "2026-03-25T00:00:00.000Z",
  },
  {
    id: "rate-helper-1",
    scopeItemId: "si-mason-helper",
    contractId: STRUCTURE,
    ratePaise: 60_000,
    rateUnit: "day",
    effectiveFrom: "2026-01-10",
    reason: "Original agreement",
    createdByName: "Aarav Mehta",
    createdAt: "2026-01-10T00:00:00.000Z",
  },
  {
    id: "rate-carpenter-1",
    scopeItemId: "si-carpenter",
    contractId: STRUCTURE,
    ratePaise: 65_000,
    rateUnit: "day",
    effectiveFrom: "2026-01-10",
    reason: "Original agreement",
    createdByName: "Aarav Mehta",
    createdAt: "2026-01-10T00:00:00.000Z",
  },
  // Compound Wall prices Mason LOWER than Structure does — same labour type,
  // same contractor, different agreement. Which agreement a day is recorded
  // against therefore changes what it is worth, which is why it can't be guessed.
  {
    id: "rate-wall-mason-1",
    scopeItemId: "si-wall-mason",
    contractId: COMPOUND_WALL,
    ratePaise: 80_000,
    rateUnit: "day",
    effectiveFrom: "2026-02-01",
    reason: "Original agreement",
    createdByName: "Aarav Mehta",
    createdAt: "2026-02-01T00:00:00.000Z",
  },
  {
    id: "rate-wall-painter-1",
    scopeItemId: "si-wall-painter",
    contractId: COMPOUND_WALL,
    ratePaise: 70_000,
    rateUnit: "day",
    effectiveFrom: "2026-02-01",
    reason: "Original agreement",
    createdByName: "Aarav Mehta",
    createdAt: "2026-02-01T00:00:00.000Z",
  },
  {
    id: "rate-orion-mason-1",
    scopeItemId: "si-orion-mason",
    contractId: ORION_AGREEMENT,
    ratePaise: 95_000,
    rateUnit: "day",
    effectiveFrom: "2026-04-01",
    reason: "Original agreement",
    createdByName: "Aarav Mehta",
    createdAt: "2026-04-01T00:00:00.000Z",
  },
];

const SEED_AMENDMENTS: AmendmentRec[] = [
  {
    id: "am-finishing-approved",
    contractId: FINISHING,
    sequence: 0,
    type: "VARIATION",
    previousAmountPaise: lakhs(60),
    revisedAmountPaise: lakhs(65),
    deltaPaise: lakhs(5),
    reason: "Additional machine room (+₹3L) and extra staircase (+₹2L)",
    effectiveDate: "2026-04-01",
    status: "APPROVED",
    requestedByName: "Aarav Mehta",
    approvedByName: "Aarav Mehta",
    approvedAt: "2026-04-01T00:00:00.000Z",
    rejectedReason: null,
    createdAt: "2026-03-28T00:00:00.000Z",
    deletedAt: null,
  },
  {
    id: "am-structure-proposed",
    contractId: STRUCTURE,
    sequence: 0,
    type: "SCOPE_CHANGE",
    previousAmountPaise: RS_60L,
    revisedAmountPaise: lakhs(63),
    deltaPaise: RS_3L,
    reason: "Additional lift-machine room slab",
    effectiveDate: "2026-06-01",
    status: "PROPOSED",
    requestedByName: "Aarav Mehta",
    approvedByName: null,
    approvedAt: null,
    rejectedReason: null,
    createdAt: "2026-05-20T00:00:00.000Z",
    deletedAt: null,
  },
];

/**
 * Attendance the demo treats as SETTLED against an agreement — ₹6,00,000 on
 * Structure. Real attendance lives in the labour store and gains a contractId
 * when the attendance UI is wired up (a later phase); until then this stands in,
 * so the acceptance case is exercisable now.
 *
 * The unsettled figure is separate on purpose: it proves that recorded-but-
 * unsettled labour does NOT reduce what is due.
 */
const SEED_ATTENDANCE: Record<string, { settled: { id: string; date: string; amountPaise: number }[]; unsettled: number }> = {
  [STRUCTURE]: {
    settled: [
      { id: "att-1", date: "2026-01-31", amountPaise: RS_3L },
      { id: "att-2", date: "2026-02-14", amountPaise: RS_3L },
    ],
    unsettled: lakhs(1),
  },
};

/* ── Storage helpers ────────────────────────────────────────────────────── */

function read<T>(key: string, seed: T[]): T[] {
  if (typeof window === "undefined") return structuredClone(seed);
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T[];
  } catch {
    /* ignore */
  }
  const s = structuredClone(seed);
  write(key, s);
  return s;
}

function write<T>(key: string, rows: T[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(rows));
  } catch {
    /* quota */
  }
}

/**
 * v1 → v2. The old shape had a single `contractAmountPaise` and used ACTIVE as
 * the working status; both map cleanly, and the retired `paymentModel` hint is
 * simply dropped. Runs once — the v1 key is removed afterwards.
 */
function migrateLegacy(): void {
  if (typeof window === "undefined") return;
  try {
    const rawContracts = window.localStorage.getItem(LEGACY.contracts);
    if (rawContracts && !window.localStorage.getItem(K.contracts)) {
      const old = JSON.parse(rawContracts) as (Omit<
        ContractRec,
        "originalAmountPaise" | "currentAmountPaise" | "status"
      > & {
        contractAmountPaise: number;
        // v1's working status was ACTIVE, which the new lifecycle splits into
        // NOT_STARTED / IN_PROGRESS.
        status: string;
      })[];
      const migrated: ContractRec[] = old.map((c) => ({
        ...c,
        reference: c.reference ?? null,
        originalAmountPaise: c.contractAmountPaise,
        currentAmountPaise: c.contractAmountPaise,
        status: (c.status === "ACTIVE" ? "IN_PROGRESS" : c.status) as ContractStatus,
        completedAt: c.completedAt ?? null,
        settledAt: c.settledAt ?? null,
        cancelledAt: c.cancelledAt ?? null,
        cancelledReason: c.cancelledReason ?? null,
      }));
      write(K.contracts, migrated);
    }
    window.localStorage.removeItem(LEGACY.contracts);

    const rawPayments = window.localStorage.getItem(LEGACY.payments);
    if (rawPayments && !window.localStorage.getItem(K.payments)) {
      const old = JSON.parse(rawPayments) as PaymentRec[];
      write(
        K.payments,
        old.map((p) => ({ ...p, milestoneId: null, clientUuid: null, reversalReason: null })),
      );
    }
    window.localStorage.removeItem(LEGACY.payments);
  } catch {
    /* a corrupt legacy blob simply falls through to the fresh seed */
  }
}

let migrated = false;
function ensureMigrated() {
  if (!migrated) {
    migrateLegacy();
    migrated = true;
  }
}

const loadContracts = () => (ensureMigrated(), read<ContractRec>(K.contracts, SEED_CONTRACTS));
const loadPayments = () => (ensureMigrated(), read<PaymentRec>(K.payments, SEED_PAYMENTS));
const loadScopeItems = () => read<ScopeItemRec>(K.scopeItems, SEED_SCOPE_ITEMS);
const loadRates = () => read<RateRec>(K.scopeRates, SEED_RATES);

/**
 * Materialise the agreement stores without going through the repository.
 *
 * The daily attendance sheet renders agreements, and a site user may well open
 * it before ever visiting a contractor page — at which point these stores would
 * not exist yet and every contractor would look agreement-less. `read` writes
 * the seed on first call, so this is idempotent.
 */
export function ensureAgreementStoresSeeded(): void {
  loadContracts();
  loadScopeItems();
  loadRates();
}
const loadMilestones = () => read<MilestoneRec>(K.milestones, SEED_MILESTONES);
const loadAmendments = () => read<AmendmentRec>(K.amendments, SEED_AMENDMENTS);

function lookupName(key: string, id: string, fallback: string): string {
  if (typeof window === "undefined") {
    // SSR / tests read from the same seeds the other demo repos use.
    if (key === CONTRACTORS && id === PAPPU) return "Pappu Contractor";
    if (key === CONTRACTORS && id === SURESH) return "Suresh Masonry";
    if (key === PROJECTS && id === PROJECT_A) return "Project A";
    if (key === PROJECTS && id === ORION) return "Orion Business Park";
    return fallback;
  }
  try {
    const rows = JSON.parse(window.localStorage.getItem(key) ?? "[]") as { id: string; name: string }[];
    return rows.find((r) => r.id === id)?.name ?? fallback;
  } catch {
    return fallback;
  }
}
const contractorName = (id: string) => lookupName(CONTRACTORS, id, "Contractor");
const projectName = (id: string) => lookupName(PROJECTS, id, "Project");

/** Whole rupees with Indian grouping — history summaries are prose, not tables. */
const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

/** Settlements, read from the contractors module's store for the History feed. */
function loadSettlementsForHistory(): {
  id: string;
  contractorId: string;
  projectName: string;
  periodStart: string;
  periodEnd: string;
  labourBillPaise: number;
  reversedAt?: string | null;
  reversalReason?: string | null;
}[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(SETTLEMENTS) ?? "[]");
  } catch {
    return [];
  }
}

/* ── Snapshot + mappers (all math via the shared engine) ────────────────── */

/** The labour taxonomy stores, owned by the labour module; read-only here. */
const LABOUR_SUBCATEGORIES = "constructly.demo.labourSubcategories.v2";
const LABOUR_CATEGORIES = "constructly.demo.labourCategories.v2";

/** A labour type's real names, so a scope item never displays a raw id. */
function labourTypeInfo(subcategoryId: string): {
  subcategoryName: string;
  categoryId: string;
  categoryName: string;
} {
  const fallback = { subcategoryName: "Labour type", categoryId: "unknown", categoryName: "Labour" };
  if (typeof window === "undefined") return fallback;
  try {
    const subs = JSON.parse(window.localStorage.getItem(LABOUR_SUBCATEGORIES) ?? "[]") as {
      id: string;
      name: string;
      categoryId: string;
    }[];
    const cats = JSON.parse(window.localStorage.getItem(LABOUR_CATEGORIES) ?? "[]") as {
      id: string;
      name: string;
    }[];
    const sub = subs.find((s) => s.id === subcategoryId);
    if (!sub) return fallback;
    const cat = cats.find((c) => c.id === sub.categoryId);
    return {
      subcategoryName: sub.name,
      categoryId: sub.categoryId,
      categoryName: cat?.name ?? fallback.categoryName,
    };
  } catch {
    return fallback;
  }
}

/** Every attendance row in the demo store. */
function liveAttendanceRows(): {
  labourSubcategoryId: string;
  contractId?: string | null;
}[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(LABOUR_ATTENDANCE) ?? "[]");
  } catch {
    return [];
  }
}

/** Attendance rows with the fields the position buckets need. */
function attendanceForPosition(): {
  contractorId?: string | null;
  projectId: string;
  estimatedCostPaise: number;
  settlementId?: string | null;
  contractId?: string | null;
}[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(LABOUR_ATTENDANCE) ?? "[]");
  } catch {
    return [];
  }
}

/**
 * Where a contractor's labour sits, per project — demo parity for
 * `contractorAttendanceByProject`. Covers projects the contractor has NO
 * agreement on, whose settled labour is unattributed by definition.
 */
function attendanceByProjectDemo(contractorId: string): ContractorProjectAttendance[] {
  const rows = attendanceForPosition().filter((a) => (a.contractorId ?? null) === contractorId);
  const byProject = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byProject.get(r.projectId) ?? [];
    list.push(r);
    byProject.set(r.projectId, list);
  }
  return [...byProject.entries()]
    .map(([projectId, list]) => ({
      projectId,
      projectName: projectName(projectId),
      ...bucketAttendance(
        list.map((r) => ({
          estimatedCostPaise: r.estimatedCostPaise,
          settlementId: r.settlementId ?? null,
          contractId: r.contractId ?? null,
        })),
      ),
    }))
    .sort((a, b) => a.projectName.localeCompare(b.projectName));
}

/**
 * Live attendance attributed to one agreement, split settled vs not.
 *
 * Settlement is the canonical recognition of attendance money: only stamped
 * rows become Attendance Credit, and the rest is informational until they are.
 */
function liveAttendanceFor(contractId: string): {
  settled: { id: string; date: string; amountPaise: number }[];
  unsettled: number;
} {
  if (typeof window === "undefined") return { settled: [], unsettled: 0 };
  let rows: {
    id: string;
    date: string;
    estimatedCostPaise: number;
    contractId?: string | null;
    settlementId?: string | null;
  }[];
  try {
    rows = JSON.parse(window.localStorage.getItem(LABOUR_ATTENDANCE) ?? "[]");
  } catch {
    return { settled: [], unsettled: 0 };
  }
  const mine = rows.filter((r) => (r.contractId ?? null) === contractId);
  return {
    settled: mine
      .filter((r) => r.settlementId)
      .map((r) => ({ id: r.id, date: r.date, amountPaise: r.estimatedCostPaise ?? 0 })),
    unsettled: mine
      .filter((r) => !r.settlementId)
      .reduce((s, r) => s + (r.estimatedCostPaise ?? 0), 0),
  };
}

function snapshotFor(rec: ContractRec): AgreementSnapshot {
  // The seed is the agreement's HISTORICAL position — labour settled before the
  // demo attendance store existed. Live agreement-attributed rows add to it, so
  // recording and settling a day in the demo moves the same figures it would in
  // production.
  const seeded = SEED_ATTENDANCE[rec.id] ?? { settled: [], unsettled: 0 };
  const live = liveAttendanceFor(rec.id);
  const attendance = {
    settled: [...seeded.settled, ...live.settled],
    unsettled: seeded.unsettled + live.unsettled,
  };
  return {
    agreementId: rec.id,
    status: rec.status,
    originalAmountPaise: rec.originalAmountPaise,
    amendments: loadAmendments()
      .filter((a) => a.contractId === rec.id && !a.deletedAt)
      .map((a) => ({
        id: a.id,
        status: a.status,
        deltaPaise: a.deltaPaise,
        effectiveDate: a.effectiveDate,
      })),
    milestones: loadMilestones()
      .filter((m) => m.contractId === rec.id && !m.deletedAt)
      .map((m) => ({
        id: m.id,
        sequence: m.sequence,
        title: m.title,
        valuePaise: m.valuePaise,
        status: m.status,
        completedAt: m.completedAt,
      })),
    attendanceCredits: attendance.settled,
    payments: loadPayments()
      .filter((p) => p.contractId === rec.id)
      .map((p) => ({
        id: p.id,
        date: p.date,
        amountPaise: p.amountPaise,
        type: p.type,
        reversedAt: p.deletedAt,
      })),
    unsettledAttendancePaise: attendance.unsettled,
  };
}

function toContract(rec: ContractRec): Contract {
  return {
    id: rec.id,
    contractorId: rec.contractorId,
    contractorName: contractorName(rec.contractorId),
    projectId: rec.projectId,
    projectName: projectName(rec.projectId),
    title: rec.title,
    reference: rec.reference,
    scope: rec.scope,
    quantity: rec.quantity,
    unit: rec.unit,
    originalAmountPaise: rec.originalAmountPaise,
    currentAmountPaise: rec.currentAmountPaise,
    startDate: rec.startDate,
    expectedCompletionDate: rec.expectedCompletionDate,
    status: rec.status,
    notes: rec.notes,
    completedAt: rec.completedAt,
    settledAt: rec.settledAt,
    cancelledAt: rec.cancelledAt,
    cancelledReason: rec.cancelledReason,
    createdAt: rec.createdAt,
    reconciliation: reconcileAgreement(snapshotFor(rec)),
  };
}

function toMilestone(rec: MilestoneRec, snapshot: AgreementSnapshot): Milestone {
  const entry = snapshot.milestones.find((m) => m.id === rec.id)!;
  const at =
    rec.status === "COMPLETED" && rec.completedAt
      ? reconciliationTimeline(snapshot).find((p) => p.date === rec.completedAt!.slice(0, 10))
      : null;
  return {
    id: rec.id,
    contractId: rec.contractId,
    sequence: rec.sequence,
    title: rec.title,
    description: rec.description,
    valuePaise: rec.valuePaise,
    plannedDate: rec.plannedDate,
    status: rec.status,
    completedAt: rec.completedAt,
    completedByName: rec.completedByName,
    cancelledAt: rec.cancelledAt,
    cancelledReason: rec.cancelledReason,
    notes: rec.notes,
    createdAt: rec.createdAt,
    financialStateAtCompletion: milestoneFinancialStateAtCompletion(snapshot, entry),
    currentCoverageState: milestoneCurrentCoverageState(snapshot, entry),
    cumulativeEarnedPaise: at?.earnedValuePaise ?? null,
    cumulativeCreditedPaise: at?.totalCreditedPaise ?? null,
    cumulativeEarnedThresholdPaise: cumulativeEarnedThroughPaise(snapshot.milestones, entry),
  };
}

const toPayment = (p: PaymentRec, milestoneTitle: string | null = null): ContractPayment => ({
  id: p.id,
  contractId: p.contractId,
  contractorId: p.contractorId,
  projectId: p.projectId,
  amountPaise: p.amountPaise,
  type: p.type,
  paymentMode: p.paymentMode,
  referenceNumber: p.referenceNumber,
  date: p.date,
  notes: p.notes,
  milestoneId: p.milestoneId,
  milestoneTitle,
  reversedAt: p.deletedAt,
  reversalReason: p.reversalReason,
  createdByName: "Aarav Mehta",
  createdAt: p.createdAt,
});

const toScopeItem = (s: ScopeItemRec): ScopeItem => ({
  id: s.id,
  contractId: s.contractId,
  labourSubcategoryId: s.labourSubcategoryId,
  subcategoryName: s.subcategoryName,
  categoryId: s.categoryId,
  categoryName: s.categoryName,
  currentRatePaise: s.currentRatePaise,
  rateUnit: s.rateUnit,
  notes: s.notes,
  createdAt: s.createdAt,
});

const toRate = (r: RateRec): RateRevision => ({
  id: r.id,
  scopeItemId: r.scopeItemId,
  ratePaise: r.ratePaise,
  rateUnit: r.rateUnit,
  effectiveFrom: r.effectiveFrom,
  reason: r.reason,
  createdByName: r.createdByName,
  createdAt: r.createdAt,
});

const toAmendment = (a: AmendmentRec): Amendment => ({
  id: a.id,
  contractId: a.contractId,
  sequence: a.sequence,
  type: a.type,
  previousAmountPaise: a.previousAmountPaise,
  revisedAmountPaise: a.revisedAmountPaise,
  deltaPaise: a.deltaPaise,
  reason: a.reason,
  effectiveDate: a.effectiveDate,
  status: a.status,
  requestedByName: a.requestedByName,
  approvedByName: a.approvedByName,
  approvedAt: a.approvedAt,
  rejectedReason: a.rejectedReason,
  createdAt: a.createdAt,
});

/**
 * Mirrors assertMilestoneChangeAllowed on the server: a cancelled agreement is
 * void, and a settled one was closed out only while earned === credited ===
 * authorised, so nothing may move earned value or planned coverage underneath it.
 */
function assertMilestoneChangeAllowed(rec: ContractRec, opts: { affectsEarnedValue: boolean }) {
  if (rec.status === "CANCELLED") throw new Error("AGREEMENT_CANCELLED");
  if (rec.status === "SETTLED" && opts.affectsEarnedValue) throw new Error("AGREEMENT_SETTLED");
}

/** Attendance rows in storage shape, mutable — the attribution correction is
 *  the only thing in this module that writes them. */
interface RawAttendance {
  id: string;
  date: string;
  projectId: string;
  labourSubcategoryId: string;
  contractorId?: string | null;
  contractId?: string | null;
  settlementId?: string | null;
  quantityPresent: number;
  dailyRatePaiseSnapshot: number | null;
  estimatedCostPaise: number;
}

function loadAttendanceRaw(): RawAttendance[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(LABOUR_ATTENDANCE) ?? "[]");
  } catch {
    return [];
  }
}

function writeAttendanceRaw(rows: RawAttendance[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LABOUR_ATTENDANCE, JSON.stringify(rows));
  } catch {
    /* quota */
  }
}

/**
 * Everything the preview and the write both need, validated once.
 *
 * Shared so the demo cannot be more permissive than the server: the same
 * eligibility, the same collision detection, the same canonical preview.
 */
function buildAttributionInputsDemo(input: {
  contractorId: string;
  projectId: string;
  contractId: string;
  attendanceIds: string[];
}):
  | {
      snapshot: ReturnType<typeof snapshotFor>;
      target: { contractId: string; title: string; projectId: string; projectName: string; status: string };
      selected: AttributionRow[];
      unattributedBeforePaise: number;
      collisions: ReturnType<typeof findCollisions>;
    }
  | { blockers: string[] } {
  const rec = loadContracts().find((c) => c.id === input.contractId && !c.deletedAt);
  if (!rec || rec.contractorId !== input.contractorId || rec.projectId !== input.projectId) {
    return { blockers: ["INVALID_TARGET"] };
  }

  const all = loadAttendanceRaw();
  const settlements = loadSettlementsForHistory();
  const reversed = new Set(settlements.filter((x) => x.reversedAt).map((x) => x.id));

  const selectedRaw = all.filter(
    (a) =>
      input.attendanceIds.includes(a.id) &&
      (a.contractorId ?? null) === input.contractorId &&
      a.projectId === input.projectId,
  );
  if (selectedRaw.length !== input.attendanceIds.length) return { blockers: ["STALE_SELECTION"] };

  const selected: AttributionRow[] = selectedRaw.map((a) => ({
    id: a.id,
    date: a.date,
    labourSubcategoryId: a.labourSubcategoryId,
    labourTypeName: labourTypeInfo(a.labourSubcategoryId).subcategoryName,
    quantityPresent: a.quantityPresent,
    dailyRatePaiseSnapshot: a.dailyRatePaiseSnapshot,
    estimatedCostPaise: a.estimatedCostPaise,
    contractId: a.contractId ?? null,
    settlementId: a.settlementId ?? null,
    settlementReversed: a.settlementId ? reversed.has(a.settlementId) : false,
  }));

  const identities = all
    .filter((a) => (a.contractId ?? null) === input.contractId)
    .map((a) => ({ date: a.date, labourSubcategoryId: a.labourSubcategoryId }));

  const unattributedBeforePaise = all
    .filter(
      (a) =>
        (a.contractorId ?? null) === input.contractorId &&
        a.projectId === input.projectId &&
        (a.contractId ?? null) === null &&
        a.settlementId != null &&
        !reversed.has(a.settlementId),
    )
    .reduce((t, a) => t + a.estimatedCostPaise, 0);

  return {
    snapshot: snapshotFor(rec),
    target: {
      contractId: rec.id,
      title: rec.title,
      projectId: rec.projectId,
      projectName: projectName(rec.projectId),
      status: rec.status,
    },
    selected,
    unattributedBeforePaise,
    collisions: findCollisions(selected, identities),
  };
}

/* ── Demo audit events (append-only) ────────────────────────────────────── */

export interface DemoEventRec {
  id: string;
  action: string;
  contractorId: string;
  summary: string;
  at: string;
  actorName: string;
  amountPaise: number | null;
  contractId: string | null;
  contractTitle: string | null;
  projectName: string | null;
  meta: Record<string, unknown>;
}

function loadEvents(): DemoEventRec[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(K.events) ?? "[]");
  } catch {
    return [];
  }
}

function appendEvent(e: DemoEventRec): void {
  write(K.events, [...loadEvents(), e]);
}

function liveContract(id: string): ContractRec {
  const rec = loadContracts().find((c) => c.id === id && !c.deletedAt);
  if (!rec) throw new Error("NOT_FOUND");
  return rec;
}

/**
 * Parity with the server's `assertRateWriteAllowed`: a rate may only be written
 * where it could still price labour — the agreement open, the contractor active.
 */
function assertRateWriteAllowedDemo(rec: ContractRec): void {
  const blocked = rateRevisionBlockedReason(rec.status);
  if (blocked) throw new Error(blocked);
  // The contractors store is owned by the contractors feature. Read it RAW —
  // `read()` would seed the key with [] when absent, and the contractors feature
  // would then treat its own store as already seeded and stay empty forever.
  // An unreadable or not-yet-seeded store simply means no archived check here;
  // the server is the authority either way.
  let contractor: { name: string; status: ContractorStatus } | undefined;
  try {
    const raw =
      typeof window === "undefined"
        ? null
        : window.localStorage.getItem("constructly.demo.contractors.v1");
    contractor = raw
      ? (JSON.parse(raw) as { id: string; name: string; status: ContractorStatus }[]).find(
          (c) => c.id === rec.contractorId,
        )
      : undefined;
  } catch {
    /* ignore */
  }
  if (!contractor) return;
  const archived = newBusinessBlockedReason(contractor.status, "REVISE_RATE", contractor.name);
  if (archived) throw new Error(`CONTRACTOR_ARCHIVED: ${archived}`);
}

function detailFor(rec: ContractRec): AgreementDetail {
  const snapshot = snapshotFor(rec);
  const milestones = loadMilestones().filter((m) => m.contractId === rec.id && !m.deletedAt);
  const titleById = new Map(milestones.map((m) => [m.id, m.title]));
  return {
    contract: toContract(rec),
    scopeItems: loadScopeItems()
      .filter((s) => s.contractId === rec.id && !s.deletedAt)
      .map(toScopeItem),
    milestones: milestones
      .sort((a, b) => a.sequence - b.sequence)
      .map((m) => toMilestone(m, snapshot)),
    payments: loadPayments()
      .filter((p) => p.contractId === rec.id)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((p) => toPayment(p, p.milestoneId ? (titleById.get(p.milestoneId) ?? null) : null)),
    amendments: loadAmendments()
      .filter((a) => a.contractId === rec.id && !a.deletedAt)
      .map(toAmendment),
    timeline: reconciliationTimeline(snapshot),
  };
}

/* ── Repository ─────────────────────────────────────────────────────────── */

/**
 * The agreement-payment rows the global Payments Centre reads.
 *
 * Uses this repository's own loaders so the v1→v2 migration and the first-read
 * seeding both apply — a raw key read would miss both and quietly report zero
 * agreement payments on a fresh session.
 */
export function demoAgreementCashSources(): {
  payments: {
    id: string;
    contractId: string;
    contractorId: string;
    projectId: string;
    amountPaise: number;
    type: string;
    paymentMode: PaymentMode;
    referenceNumber: string | null;
    date: string;
    notes: string | null;
    deletedAt: string | null;
    reversalReason: string | null;
  }[];
  contracts: { id: string; title: string }[];
} {
  return {
    payments: loadPayments().map((p) => ({
      id: p.id,
      contractId: p.contractId,
      contractorId: p.contractorId,
      projectId: p.projectId,
      amountPaise: p.amountPaise,
      type: p.type,
      paymentMode: p.paymentMode,
      referenceNumber: p.referenceNumber,
      date: p.date,
      notes: p.notes,
      deletedAt: p.deletedAt,
      reversalReason: p.reversalReason,
    })),
    contracts: loadContracts().map((c) => ({ id: c.id, title: c.title })),
  };
}

export const demoContractsRepository: ContractsRepository = {
  async listContracts(filters: ContractFilters = {}) {
    return loadContracts()
      .filter((c) => !c.deletedAt)
      .filter((c) => (filters.contractorId ? c.contractorId === filters.contractorId : true))
      .filter((c) => (filters.projectId ? c.projectId === filters.projectId : true))
      .filter((c) => (filters.status && filters.status !== "ALL" ? c.status === filters.status : true))
      .map(toContract);
  },

  async getContract(id) {
    const rec = loadContracts().find((c) => c.id === id && !c.deletedAt);
    return rec ? detailFor(rec) : null;
  },

  async createContract(input) {
    const rows = loadContracts();
    const rec: ContractRec = {
      id: uid(),
      contractorId: input.contractorId,
      projectId: input.projectId,
      title: input.title,
      reference: input.reference ?? null,
      scope: input.scope ?? null,
      quantity: input.quantity ?? null,
      unit: input.unit ?? null,
      // The agreed value seeds both; original is immutable from here.
      originalAmountPaise: input.contractAmountPaise,
      currentAmountPaise: input.contractAmountPaise,
      startDate: input.startDate ?? null,
      expectedCompletionDate: input.expectedCompletionDate ?? null,
      status: "NOT_STARTED",
      notes: input.notes ?? null,
      completedAt: null,
      settledAt: null,
      cancelledAt: null,
      cancelledReason: null,
      createdAt: nowISO(),
      deletedAt: null,
    };
    rows.push(rec);
    write(K.contracts, rows);
    return toContract(rec);
  },

  async updateContract(id, patch) {
    // Mirrors the server: the commercial value is not editable here.
    if ("contractAmountPaise" in (patch as Record<string, unknown>)) {
      throw new Error("USE_AMENDMENT");
    }
    const rows = loadContracts();
    const rec = rows.find((c) => c.id === id && !c.deletedAt);
    if (!rec) throw new Error("NOT_FOUND");
    Object.assign(rec, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.reference !== undefined ? { reference: patch.reference } : {}),
      ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
      ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}),
      ...(patch.unit !== undefined ? { unit: patch.unit } : {}),
      ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
      ...(patch.expectedCompletionDate !== undefined
        ? { expectedCompletionDate: patch.expectedCompletionDate }
        : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    });
    write(K.contracts, rows);
    return toContract(rec);
  },

  async setContractStatus(id, status) {
    const rows = loadContracts();
    const rec = rows.find((c) => c.id === id && !c.deletedAt);
    if (!rec) throw new Error("NOT_FOUND");
    if (status === "CANCELLED") throw new Error("USE_CANCEL");
    if (!canTransitionAgreement(rec.status, status)) throw new Error("INVALID_STATUS_TRANSITION");

    if (status === "SETTLED") {
      const snapshot = snapshotFor(rec);
      const blocked = canSettleAgreement({
        reconciliation: reconcileAgreement(snapshot),
        milestones: snapshot.milestones,
      });
      if (blocked) throw new Error(`AGREEMENT_NOT_FULLY_RECONCILED: ${blocked}`);
    }

    rec.status = status;
    if (status === "COMPLETED") rec.completedAt = nowISO();
    if (status === "SETTLED") rec.settledAt = nowISO();
    write(K.contracts, rows);
    return toContract(rec);
  },

  async cancelContract(id, reason) {
    if (!reason.trim()) throw new Error("CANCEL_REASON_REQUIRED");
    const rows = loadContracts();
    const rec = rows.find((c) => c.id === id && !c.deletedAt);
    if (!rec) throw new Error("NOT_FOUND");
    if (rec.status === "CANCELLED") throw new Error("ALREADY_CANCELLED");
    rec.status = "CANCELLED";
    rec.cancelledAt = nowISO();
    rec.cancelledReason = reason;
    write(K.contracts, rows);
    return toContract(rec);
  },

  async deleteContract(id) {
    const rows = loadContracts();
    const rec = rows.find((c) => c.id === id && !c.deletedAt);
    if (!rec) throw new Error("NOT_FOUND");

    const hasPayments = loadPayments().some((p) => p.contractId === id && !p.deletedAt);
    const hasCompleted = loadMilestones().some(
      (m) => m.contractId === id && !m.deletedAt && m.status === "COMPLETED",
    );
    const hasAttendance = (SEED_ATTENDANCE[id]?.settled.length ?? 0) > 0;
    const hasApproved = loadAmendments().some(
      (a) => a.contractId === id && !a.deletedAt && a.status === "APPROVED",
    );
    if (hasPayments || hasCompleted || hasAttendance || hasApproved) {
      throw new Error("HAS_FINANCIAL_HISTORY");
    }

    rec.deletedAt = nowISO();
    write(K.contracts, rows);
  },

  /* ── Scope & rates ────────────────────────────────────────────────────── */

  async listScopeItems(contractId) {
    return loadScopeItems()
      .filter((s) => s.contractId === contractId && !s.deletedAt)
      .map(toScopeItem);
  },

  async addScopeItem(input) {
    const contract = liveContract(input.contractId);
    assertRateWriteAllowedDemo(contract);
    const invalid = validateRateRevision({
      ratePaise: input.ratePaise,
      effectiveFrom: input.effectiveFrom,
      agreementStartDate: contract.startDate,
    });
    if (invalid) throw new Error(`INVALID_RATE: ${invalid}`);

    const items = loadScopeItems();
    if (
      items.some(
        (s) =>
          s.contractId === input.contractId &&
          s.labourSubcategoryId === input.labourSubcategoryId &&
          !s.deletedAt,
      )
    ) {
      throw new Error("SCOPE_ITEM_EXISTS");
    }

    // Resolve the REAL taxonomy names. The attendance sheet renders a scope
    // item as a labour-type row, so storing the raw id here would put a UUID in
    // front of the person recording headcount.
    const taxonomy = labourTypeInfo(input.labourSubcategoryId);
    const rec: ScopeItemRec = {
      id: uid(),
      contractId: input.contractId,
      labourSubcategoryId: input.labourSubcategoryId,
      subcategoryName: taxonomy.subcategoryName,
      categoryId: taxonomy.categoryId,
      categoryName: taxonomy.categoryName,
      currentRatePaise: input.ratePaise,
      rateUnit: input.rateUnit ?? "day",
      notes: input.notes ?? null,
      createdAt: nowISO(),
      deletedAt: null,
    };
    items.push(rec);
    write(K.scopeItems, items);

    const rates = loadRates();
    rates.push({
      id: uid(),
      scopeItemId: rec.id,
      contractId: input.contractId,
      ratePaise: input.ratePaise,
      rateUnit: rec.rateUnit,
      effectiveFrom: input.effectiveFrom,
      reason: "Original agreement",
      createdByName: "Aarav Mehta",
      createdAt: nowISO(),
    });
    write(K.scopeRates, rates);
    return toScopeItem(rec);
  },

  async removeScopeItem(id) {
    const items = loadScopeItems();
    const rec = items.find((s) => s.id === id && !s.deletedAt);
    if (!rec) throw new Error("NOT_FOUND");
    // History must stay resolvable: attendance recorded under this agreement for
    // this labour type resolves its rate through this item's revisions, so the
    // item cannot leave scope. Live rows are checked exactly (agreement + type),
    // matching the server; the seeded pre-Phase-6 attendance is agreement-level
    // only, so it pins the whole scope conservatively.
    const usedLive = liveAttendanceRows().some(
      (a) =>
        (a.contractId ?? null) === rec.contractId &&
        a.labourSubcategoryId === rec.labourSubcategoryId,
    );
    if (usedLive || (SEED_ATTENDANCE[rec.contractId]?.settled.length ?? 0) > 0) {
      throw new Error("SCOPE_IN_USE");
    }
    rec.deletedAt = nowISO();
    write(K.scopeItems, items);
  },

  async listRateRevisions(scopeItemId) {
    return loadRates()
      .filter((r) => r.scopeItemId === scopeItemId)
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))
      .map(toRate);
  },

  async setScopeRate(input) {
    const items = loadScopeItems();
    const rec = items.find((s) => s.id === input.scopeItemId && !s.deletedAt);
    if (!rec) throw new Error("NOT_FOUND");
    const contract = liveContract(rec.contractId);
    assertRateWriteAllowedDemo(contract);

    const invalid = validateRateRevision({
      ratePaise: input.ratePaise,
      effectiveFrom: input.effectiveFrom,
      agreementStartDate: contract.startDate,
    });
    if (invalid) throw new Error(`INVALID_RATE: ${invalid}`);

    const rates = loadRates();
    rates.push({
      id: uid(),
      scopeItemId: rec.id,
      contractId: rec.contractId,
      ratePaise: input.ratePaise,
      rateUnit: input.rateUnit ?? rec.rateUnit,
      effectiveFrom: input.effectiveFrom,
      reason: input.reason ?? null,
      createdByName: "Aarav Mehta",
      createdAt: nowISO(),
    });
    write(K.scopeRates, rates);

    // Recompute from the whole ledger as at today — a future-dated revision must
    // not change what the agreement charges right now.
    const inForce = effectiveRateOn(
      rates.filter((r) => r.scopeItemId === rec.id),
      todayISO(),
    );
    if (inForce) {
      rec.currentRatePaise = inForce.ratePaise;
      rec.rateUnit = inForce.rateUnit;
      write(K.scopeItems, items);
    }
    return toScopeItem(rec);
  },

  /* ── Milestones ───────────────────────────────────────────────────────── */

  async listMilestones(contractId) {
    const rec = liveContract(contractId);
    const snapshot = snapshotFor(rec);
    return loadMilestones()
      .filter((m) => m.contractId === contractId && !m.deletedAt)
      .sort((a, b) => a.sequence - b.sequence)
      .map((m) => toMilestone(m, snapshot));
  },

  async createMilestone(input) {
    return this.createMilestonesBulk(input.contractId, [input]);
  },

  async createMilestonesBulk(contractId, inputs) {
    assertMilestoneChangeAllowed(liveContract(contractId), { affectsEarnedValue: true });
    const rows = loadMilestones();
    const base = rows.filter((m) => m.contractId === contractId && !m.deletedAt).length;
    inputs.forEach((input, i) => {
      rows.push({
        id: uid(),
        contractId,
        sequence: input.sequence ?? base + i,
        title: input.title,
        description: input.description ?? null,
        valuePaise: input.valuePaise,
        plannedDate: input.plannedDate ?? null,
        status: "NOT_STARTED",
        completedAt: null,
        completedByName: null,
        cancelledAt: null,
        cancelledReason: null,
        notes: input.notes ?? null,
        createdAt: nowISO(),
        deletedAt: null,
      });
    });
    write(K.milestones, rows);
    return this.listMilestones(contractId);
  },

  async updateMilestone(id, patch) {
    const rows = loadMilestones();
    const rec = rows.find((m) => m.id === id && !m.deletedAt);
    if (!rec) throw new Error("NOT_FOUND");
    const contract = liveContract(rec.contractId);
    assertMilestoneChangeAllowed(contract, { affectsEarnedValue: patch.valuePaise !== undefined });

    if (patch.valuePaise !== undefined && rec.status === "COMPLETED") {
      const snapshot = snapshotFor(contract);
      const others = completedValuePaise(snapshot.milestones.filter((m) => m.id !== id));
      const blocked = validateMilestoneCompletion({
        alreadyCompletedValuePaise: others,
        thisMilestoneValuePaise: patch.valuePaise,
        currentContractValuePaise: reconcileAgreement(snapshot).currentContractValuePaise,
      });
      if (blocked) throw new Error(`EARNED_VALUE_EXCEEDS_CONTRACT: ${blocked}`);
    }

    Object.assign(rec, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.valuePaise !== undefined ? { valuePaise: patch.valuePaise } : {}),
      ...(patch.plannedDate !== undefined ? { plannedDate: patch.plannedDate } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    });
    write(K.milestones, rows);
    return this.listMilestones(rec.contractId);
  },

  async setMilestoneStatus(id, status, opts = {}) {
    const rows = loadMilestones();
    const rec = rows.find((m) => m.id === id && !m.deletedAt);
    if (!rec) throw new Error("NOT_FOUND");
    const contract = liveContract(rec.contractId);
    assertMilestoneChangeAllowed(contract, { affectsEarnedValue: true });
    if (status === "CANCELLED" && !opts.reason) throw new Error("CANCEL_REASON_REQUIRED");

    const linked = loadPayments()
      .filter((p) => p.milestoneId === id && !p.deletedAt)
      .reduce((acc, p) => acc + p.amountPaise, 0);

    const blockedTransition = validateMilestoneTransition({
      from: rec.status,
      to: status,
      linkedNonReversedPaymentPaise: linked,
    });
    if (blockedTransition) {
      throw new Error(
        status === "CANCELLED" && linked > 0
          ? `MILESTONE_HAS_PAYMENTS: ${blockedTransition}`
          : `INVALID_STATUS_TRANSITION: ${blockedTransition}`,
      );
    }

    if (status === "COMPLETED") {
      const snapshot = snapshotFor(contract);
      const others = completedValuePaise(snapshot.milestones.filter((m) => m.id !== id));
      const blocked = validateMilestoneCompletion({
        alreadyCompletedValuePaise: others,
        thisMilestoneValuePaise: rec.valuePaise,
        currentContractValuePaise: contract.currentAmountPaise,
      });
      if (blocked) throw new Error(`EARNED_VALUE_EXCEEDS_CONTRACT: ${blocked}`);
    }

    rec.status = status;
    rec.completedAt = status === "COMPLETED" ? nowISO() : null;
    rec.completedByName = status === "COMPLETED" ? "Aarav Mehta" : null;
    rec.cancelledAt = status === "CANCELLED" ? nowISO() : null;
    rec.cancelledReason = status === "CANCELLED" ? (opts.reason ?? null) : null;
    write(K.milestones, rows);
    return this.listMilestones(rec.contractId);
  },

  async deleteMilestone(id) {
    const rows = loadMilestones();
    const rec = rows.find((m) => m.id === id && !m.deletedAt);
    if (!rec) throw new Error("NOT_FOUND");
    assertMilestoneChangeAllowed(liveContract(rec.contractId), { affectsEarnedValue: true });
    if (rec.status !== "NOT_STARTED") throw new Error("MILESTONE_HAS_HISTORY");
    if (loadPayments().some((p) => p.milestoneId === id && !p.deletedAt)) {
      throw new Error("MILESTONE_HAS_PAYMENTS");
    }
    rec.deletedAt = nowISO();
    write(K.milestones, rows);
    return this.listMilestones(rec.contractId);
  },

  async reorderMilestones(contractId, orderedIds) {
    // Ordering is presentation, not value — permitted on a settled agreement.
    assertMilestoneChangeAllowed(liveContract(contractId), { affectsEarnedValue: false });
    const rows = loadMilestones();
    const mine = rows.filter((m) => m.contractId === contractId && !m.deletedAt);
    const owned = new Set(mine.map((m) => m.id));
    if (orderedIds.some((id) => !owned.has(id))) throw new Error("INVALID_MILESTONE");
    orderedIds.forEach((id, i) => {
      const rec = rows.find((m) => m.id === id);
      if (rec) rec.sequence = i;
    });
    write(K.milestones, rows);
    return this.listMilestones(contractId);
  },

  /* ── Amendments ───────────────────────────────────────────────────────── */

  async listAmendments(contractId) {
    return loadAmendments()
      .filter((a) => a.contractId === contractId && !a.deletedAt)
      .map(toAmendment);
  },

  async proposeAmendment(input) {
    const contract = liveContract(input.contractId);
    if (contract.status === "CANCELLED") throw new Error("AGREEMENT_CANCELLED");
    if (!input.reason.trim()) throw new Error("REASON_REQUIRED");

    const floor = validateRevisedValue({
      revisedAmountPaise: input.revisedAmountPaise,
      reconciliation: reconcileAgreement(snapshotFor(contract)),
    });
    if (floor) throw new Error(floor);
    if (input.revisedAmountPaise === contract.currentAmountPaise) throw new Error("NO_VALUE_CHANGE");

    const rows = loadAmendments();
    rows.push({
      id: uid(),
      contractId: input.contractId,
      sequence: rows.filter((a) => a.contractId === input.contractId && !a.deletedAt).length,
      type: input.type,
      previousAmountPaise: contract.currentAmountPaise,
      revisedAmountPaise: input.revisedAmountPaise,
      deltaPaise: input.revisedAmountPaise - contract.currentAmountPaise,
      reason: input.reason,
      effectiveDate: input.effectiveDate,
      status: "PROPOSED",
      requestedByName: "Aarav Mehta",
      approvedByName: null,
      approvedAt: null,
      rejectedReason: null,
      createdAt: nowISO(),
      deletedAt: null,
    });
    write(K.amendments, rows);
    return this.listAmendments(input.contractId);
  },

  async approveAmendment(id) {
    const rows = loadAmendments();
    const rec = rows.find((a) => a.id === id && !a.deletedAt);
    if (!rec) throw new Error("NOT_FOUND");
    if (rec.status !== "PROPOSED") throw new Error("AMENDMENT_NOT_PROPOSED");

    const contracts = loadContracts();
    const contract = contracts.find((c) => c.id === rec.contractId && !c.deletedAt);
    if (!contract) throw new Error("NOT_FOUND");
    if (contract.status === "CANCELLED") throw new Error("AGREEMENT_CANCELLED");
    if (contract.status === "SETTLED") throw new Error("AGREEMENT_SETTLED");
    // Another amendment landed first — this one was proposed against a value
    // nobody is looking at any more.
    if (contract.currentAmountPaise !== rec.previousAmountPaise) throw new Error("AMENDMENT_STALE");

    // The floor, re-checked against the position NOW rather than at proposal
    // time: a reduction proposed while little was earned must not land after
    // milestones have carried earned value above it.
    const blocked = validateRevisedValue({
      revisedAmountPaise: rec.revisedAmountPaise,
      reconciliation: reconcileAgreement(snapshotFor(contract)),
    });
    if (blocked) throw new Error(blocked);

    rec.status = "APPROVED";
    rec.approvedByName = "Aarav Mehta";
    rec.approvedAt = nowISO();
    contract.currentAmountPaise = rec.revisedAmountPaise;
    write(K.amendments, rows);
    write(K.contracts, contracts);
    return this.listAmendments(rec.contractId);
  },

  async rejectAmendment(id, reason) {
    const rows = loadAmendments();
    const rec = rows.find((a) => a.id === id && !a.deletedAt);
    if (!rec) throw new Error("NOT_FOUND");
    if (rec.status !== "PROPOSED") throw new Error("AMENDMENT_NOT_PROPOSED");
    if (!reason.trim()) throw new Error("REASON_REQUIRED");
    rec.status = "REJECTED";
    rec.rejectedReason = reason;
    rec.approvedByName = "Aarav Mehta";
    rec.approvedAt = nowISO();
    write(K.amendments, rows);
    return this.listAmendments(rec.contractId);
  },

  /* ── Payments ─────────────────────────────────────────────────────────── */

  async recordContractPayment(input) {
    const contract = liveContract(input.contractId);
    if (contract.status === "CANCELLED") throw new Error("AGREEMENT_CANCELLED");

    const rows = loadPayments();

    // Idempotency parity with the server: a repeated submit with the same key
    // returns the original rather than recording the money twice.
    if (input.clientUuid) {
      const seen = rows.find(
        (p) => p.clientUuid === input.clientUuid && p.contractId === input.contractId,
      );
      if (seen) return detailFor(contract);
    }

    const recon = reconcileAgreement(snapshotFor(contract));
    const blocked = validateCreditCeiling({
      additionalCreditPaise: input.amountPaise,
      totalCreditedPaise: recon.totalCreditedPaise,
      currentContractValuePaise: recon.currentContractValuePaise,
    });
    if (blocked) throw new Error(`CREDIT_EXCEEDS_CONTRACT_VALUE: ${blocked}`);

    rows.push({
      id: uid(),
      contractId: input.contractId,
      contractorId: contract.contractorId,
      projectId: contract.projectId,
      amountPaise: input.amountPaise,
      type: input.type,
      paymentMode: input.paymentMode,
      referenceNumber: input.referenceNumber ?? null,
      date: input.date,
      notes: input.notes ?? null,
      milestoneId: input.milestoneId ?? null,
      clientUuid: input.clientUuid ?? null,
      createdAt: nowISO(),
      deletedAt: null,
      reversalReason: null,
    });
    write(K.payments, rows);
    return detailFor(liveContract(input.contractId));
  },

  async reverseContractPayment(id, reason) {
    if (!reason.trim()) throw new Error("REVERSAL_REASON_REQUIRED");
    const rows = loadPayments();
    const rec = rows.find((p) => p.id === id && !p.deletedAt);
    if (!rec) throw new Error("NOT_FOUND");
    rec.deletedAt = nowISO();
    rec.reversalReason = reason;
    write(K.payments, rows);
  },

  /* ── Settled-attribution correction ───────────────────────────────────── */

  async listAttributableLabour(contractorId, projectId) {
    const settlements = loadSettlementsForHistory();
    const reversed = new Set(settlements.filter((x) => x.reversedAt).map((x) => x.id));
    const byId = new Map(settlements.map((x) => [x.id, x]));
    return loadAttendanceRaw()
      .filter(
        (a) =>
          (a.contractorId ?? null) === contractorId &&
          a.projectId === projectId &&
          (a.contractId ?? null) === null &&
          a.settlementId != null &&
          !reversed.has(a.settlementId),
      )
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((a) => {
        const s2 = byId.get(a.settlementId!);
        return {
          id: a.id,
          date: a.date,
          labourTypeName: labourTypeInfo(a.labourSubcategoryId).subcategoryName,
          quantityPresent: a.quantityPresent,
          dailyRatePaiseSnapshot: a.dailyRatePaiseSnapshot,
          estimatedCostPaise: a.estimatedCostPaise,
          settlementId: a.settlementId!,
          settlementPeriod: s2 ? `${s2.periodStart} – ${s2.periodEnd}` : "",
        };
      });
  },

  async previewAttribution(input) {
    const built = buildAttributionInputsDemo(input);
    if ("blockers" in built) return built;
    return buildAttributionPreview(built);
  },

  async attributeSettledLabour(input) {
    if (!input.reason.trim()) return { blockers: ["REASON_REQUIRED"] };
    if (input.attendanceIds.length === 0) return { blockers: ["NOTHING_SELECTED"] };
    const built = buildAttributionInputsDemo(input);
    if ("blockers" in built) return built;

    const preview = buildAttributionPreview(built);
    // All or nothing — parity with the server's transaction.
    if (preview.blockers.length > 0) {
      return { blockers: preview.blockers, collisions: built.collisions };
    }

    const rows = loadAttendanceRaw();
    for (const r of rows) {
      if (input.attendanceIds.includes(r.id)) r.contractId = input.contractId;
    }
    writeAttendanceRaw(rows);

    const id = uid();
    appendEvent({
      id,
      action: "contractor.attendance_attributed",
      contractorId: input.contractorId,
      summary: `Attributed ${preview.rowCount} settled attendance record${preview.rowCount === 1 ? "" : "s"} to "${built.target.title}"`,
      at: nowISO(),
      actorName: "Aarav Mehta",
      amountPaise: preview.totalPaise,
      contractId: input.contractId,
      contractTitle: built.target.title,
      projectName: built.target.projectName,
      meta: {
        projectId: input.projectId,
        contractorId: input.contractorId,
        attendanceIds: input.attendanceIds,
        settlementIds: preview.settlementIds,
        fromContractId: null,
        toContractId: input.contractId,
        toContractTitle: built.target.title,
        rowCount: preview.rowCount,
        totalPaise: preview.totalPaise,
        reason: input.reason.trim(),
      },
    });

    return {
      correctionId: id,
      rowCount: preview.rowCount,
      totalPaise: preview.totalPaise,
      contractId: input.contractId,
      contractTitle: built.target.title,
    };
  },

  async reverseAttribution(input) {
    if (!input.reason.trim()) return { blockers: ["REASON_REQUIRED"] };
    const events = loadEvents();
    const original = events.find(
      (e) => e.id === input.correctionId && e.action === "contractor.attendance_attributed",
    );
    if (!original) return { blockers: ["NOT_FOUND"] };
    if (events.some((e) => e.meta?.correctionId === input.correctionId)) {
      return { blockers: ["ALREADY_REVERSED"] };
    }

    const ids = (original.meta.attendanceIds as string[]) ?? [];
    const target = original.meta.toContractId as string;
    const rows = loadAttendanceRaw();
    const affected = rows.filter((r) => ids.includes(r.id));
    const settlements = loadSettlementsForHistory();
    const reversed = new Set(settlements.filter((x) => x.reversedAt).map((x) => x.id));

    // Refuse rather than guess: restoring only the rows that still match would
    // leave a state nobody asked for and an audit entry describing something else.
    if (
      affected.length !== ids.length ||
      affected.some(
        (r) =>
          (r.contractId ?? null) !== target ||
          r.settlementId == null ||
          reversed.has(r.settlementId),
      )
    ) {
      return { blockers: ["STALE_SELECTION"] };
    }

    const totalPaise = affected.reduce((t, r) => t + r.estimatedCostPaise, 0);
    for (const r of rows) if (ids.includes(r.id)) r.contractId = null;
    writeAttendanceRaw(rows);

    const id = uid();
    appendEvent({
      id,
      action: "contractor.attendance_attribution_reversed",
      contractorId: original.contractorId,
      summary: `Reversed the attribution of ${affected.length} settled attendance record${affected.length === 1 ? "" : "s"} from "${original.contractTitle}"`,
      at: nowISO(),
      actorName: "Aarav Mehta",
      amountPaise: totalPaise,
      contractId: null,
      contractTitle: original.contractTitle,
      projectName: original.projectName,
      meta: {
        correctionId: input.correctionId,
        projectId: original.meta.projectId,
        attendanceIds: ids,
        fromContractId: target,
        fromContractTitle: original.contractTitle,
        toContractId: null,
        rowCount: affected.length,
        totalPaise,
        reason: input.reason.trim(),
      },
    });

    return {
      correctionId: id,
      rowCount: affected.length,
      totalPaise,
      contractId: null,
      contractTitle: original.contractTitle,
    };
  },

  /* ── Reconciliation surfaces ──────────────────────────────────────────── */

  async getContractorProfile(contractorId) {
    const rows = loadContracts().filter((c) => c.contractorId === contractorId && !c.deletedAt);
    if (rows.length === 0) {
      // No agreements does NOT mean no labour: an attendance-only contractor's
      // settled work is unattributed by definition and must still be reported.
      const attendanceOnly = attendanceByProjectDemo(contractorId);
      return {
        contractor: { id: contractorId, name: contractorName(contractorId), phone: null, status: "ACTIVE" },
        projects: [],
        lifetime: rollUpReconciliations([]),
        payments: [],
        attendance: attendanceOnly,
        attendanceTotals: sumPositions(attendanceOnly),
      };
    }

    const contracts = rows.map(toContract);
    const byProject = new Map<string, Contract[]>();
    for (const c of contracts) {
      const list = byProject.get(c.projectId) ?? [];
      list.push(c);
      byProject.set(c.projectId, list);
    }

    const projects: ProjectAgreementsGroup[] = [...byProject.entries()].map(([projectId, list]) => ({
      projectId,
      projectName: list[0].projectName,
      contracts: list,
      rollup: rollUpReconciliations(list.map((c) => c.reconciliation)),
    }));

    const attendance = attendanceByProjectDemo(contractorId);
    const titleById = new Map(rows.map((r) => [r.id, r.title]));
    const nameById = new Map(rows.map((r) => [r.id, projectName(r.projectId)]));
    const payments: ContractPaymentHistoryRow[] = loadPayments()
      .filter((p) => rows.some((r) => r.id === p.contractId))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((p) => ({
        ...toPayment(p),
        projectName: nameById.get(p.contractId) ?? "Project",
        contractTitle: titleById.get(p.contractId) ?? "Agreement",
      }));

    return {
      contractor: {
        id: contractorId,
        name: contractorName(contractorId),
        phone: null,
        status: "ACTIVE",
      },
      projects,
      // Sums each agreement's due and ahead — never nets them against each other.
      lifetime: rollUpReconciliations(contracts.map((c) => c.reconciliation)),
      payments,
      attendance,
      attendanceTotals: sumPositions(attendance),
    };
  },

  /**
   * Demo history is DERIVED from the records themselves rather than a separate
   * event store — the agreements, amendments, milestone completions, payments
   * and reversals all carry their own timestamps, so nothing here is invented.
   * The server reads the real ActivityLog instead.
   */
  async listHistory(contractorId) {
    const rows = loadContracts().filter((c) => c.contractorId === contractorId && !c.deletedAt);
    const ids = new Set(rows.map((c) => c.id));
    const titleOf = new Map(rows.map((c) => [c.id, c.title]));
    const projectOf = new Map(rows.map((c) => [c.id, projectName(c.projectId)]));

    const event = (
      id: string,
      contractId: string,
      action: string,
      summary: string,
      at: string,
      amountPaise: number | null,
    ): HistoryEvent => ({
      id,
      action,
      summary,
      at,
      actorName: "Aarav Mehta",
      amountPaise,
      contractId,
      contractTitle: titleOf.get(contractId) ?? null,
      projectName: projectOf.get(contractId) ?? null,
    });

    const events: HistoryEvent[] = [];

    for (const c of rows) {
      events.push(
        event(`h-created-${c.id}`, c.id, "contract.created", `Created agreement "${c.title}"`, c.createdAt, c.originalAmountPaise),
      );
      if (c.cancelledAt) {
        events.push(
          event(`h-cancelled-${c.id}`, c.id, "contract.cancelled", `Cancelled "${c.title}": ${c.cancelledReason ?? ""}`, c.cancelledAt, null),
        );
      }
    }

    for (const a of loadAmendments().filter((x) => ids.has(x.contractId) && !x.deletedAt)) {
      events.push(
        event(`h-am-${a.id}`, a.contractId, "contract.amendment_created", `Proposed amendment: ${a.reason}`, a.createdAt, a.deltaPaise),
      );
      if (a.status === "APPROVED" && a.approvedAt) {
        events.push(
          event(`h-am-ok-${a.id}`, a.contractId, "contract.amendment_approved", `Approved amendment — authorised value now ${rupees(a.revisedAmountPaise)}`, a.approvedAt, a.deltaPaise),
        );
      }
      if (a.status === "REJECTED" && a.approvedAt) {
        events.push(
          event(`h-am-no-${a.id}`, a.contractId, "contract.amendment_rejected", `Rejected amendment: ${a.rejectedReason ?? ""}`, a.approvedAt, null),
        );
      }
    }

    for (const m of loadMilestones().filter((x) => ids.has(x.contractId) && !x.deletedAt)) {
      if (m.completedAt) {
        events.push(
          event(`h-ms-${m.id}`, m.contractId, "contract.milestone_completed", `Milestone completed: ${m.title}`, m.completedAt, m.valuePaise),
        );
      }
    }

    for (const r of loadRates().filter((x) => ids.has(x.contractId))) {
      events.push(
        event(`h-rate-${r.id}`, r.contractId, "contract.rate_revised", `Rate set to ${rupees(r.ratePaise)}/${r.rateUnit} from ${r.effectiveFrom}${r.reason ? ` — ${r.reason}` : ""}`, r.createdAt, r.ratePaise),
      );
    }

    for (const p of loadPayments().filter((x) => ids.has(x.contractId))) {
      events.push(
        event(`h-pay-${p.id}`, p.contractId, "contract.payment_recorded", `Recorded ${p.type.toLowerCase()} payment`, p.createdAt, p.amountPaise),
      );
      if (p.deletedAt) {
        events.push(
          event(`h-rev-${p.id}`, p.contractId, "contract.payment_reversed", `Reversed payment: ${p.reversalReason ?? ""}`, p.deletedAt, p.amountPaise),
        );
      }
    }

    // Settlement reversals belong to the contractor, not to one agreement, so
    // they carry no contract context — but they are commercial history and the
    // feed would be misleading without them.
    for (const s of loadSettlementsForHistory().filter(
      (x) => x.contractorId === contractorId && x.reversedAt,
    )) {
      events.push({
        id: `h-strev-${s.id}`,
        action: "contractor.settlement_reversed",
        summary: `Reversed the ${s.periodStart} – ${s.periodEnd} settlement: ${s.reversalReason ?? ""}`,
        at: s.reversedAt!,
        actorName: "Aarav Mehta",
        amountPaise: s.labourBillPaise,
        contractId: null,
        contractTitle: null,
        projectName: s.projectName,
      });
    }

    // Derived events, PLUS the explicit correction events — an attribution
    // leaves no trace in current state, so it cannot be reconstructed like the
    // rest. `attributionReversedAt` lets History offer (or withhold) the
    // reversal action without a second round trip.
    const stored = loadEvents().filter((e) => e.contractorId === contractorId);
    const reversedBy = new Map(
      stored
        .filter((e) => e.action === "contractor.attendance_attribution_reversed")
        .map((e) => [e.meta.correctionId as string, e.at]),
    );
    for (const e of stored) {
      events.push({
        id: e.id,
        action: e.action,
        summary: e.summary,
        at: e.at,
        actorName: e.actorName,
        amountPaise: e.amountPaise,
        contractId: e.contractId,
        contractTitle: e.contractTitle,
        projectName: e.projectName,
        ...(e.action === "contractor.attendance_attributed"
          ? { attributionReversedAt: reversedBy.get(e.id) ?? null }
          : {}),
      });
    }

    return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  },

  async projectContractsSummary(projectId) {
    const rows = loadContracts().filter((c) => c.projectId === projectId && !c.deletedAt);
    const byContractor = new Map<string, ReturnType<typeof reconcileAgreement>[]>();
    for (const row of rows) {
      const list = byContractor.get(row.contractorId) ?? [];
      list.push(reconcileAgreement(snapshotFor(row)));
      byContractor.set(row.contractorId, list);
    }
    const out: ProjectContractorSummaryRow[] = [...byContractor.entries()].map(
      ([contractorId, recons]) => {
        const roll = rollUpReconciliations(recons);
        return {
          contractorId,
          contractorName: contractorName(contractorId),
          agreementCount: roll.agreementCount,
          contractValuePaise: roll.totalContractValuePaise,
          earnedPaise: roll.totalEarnedPaise,
          creditedPaise: roll.totalCreditedPaise,
          currentDuePaise: roll.totalCurrentDuePaise,
          advanceCreditPaise: roll.totalAdvanceCreditPaise,
        };
      },
    );
    return out.sort((a, b) => a.contractorName.localeCompare(b.contractorName));
  },
};

/** Exported for the repository tests, so expectations name the same rows. */
export const DEMO_IDS = {
  STRUCTURE,
  COMPOUND_WALL,
  FINISHING,
  ORION_AGREEMENT,
  PAPPU,
  PROJECT_A,
  ORION,
} as const;

/** Re-exported so tests can assert against the same figures the seed uses. */
export const DEMO_AMOUNTS = { RS_2L, RS_3L, RS_6L, RS_8L, RS_10L, RS_60L } as const;

/** Bands for a scope item's rate history (used by the Rates tab). */
export function demoRateBands(scopeItemId: string) {
  return rateBands(loadRates().filter((r) => r.scopeItemId === scopeItemId).map(toRate));
}
