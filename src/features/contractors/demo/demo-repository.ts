import {
  advanceBalancePaise,
  allocateAdvanceDrawdown,
  computeSettlement,
  maxAdjustmentPaise,
  outstandingPerAdvance,
  unusableAdvances,
  validateAdjustment,
  type BillComposition,
} from "../calc";
import { findDuplicates, newBusinessBlockedReason } from "../lifecycle";
import type {
  ContractorsRepository,
  SettlementFilters,
  SettlementPreviewInput,
} from "../repository";
import type {
  Contractor,
  ContractorFilters,
  ContractorLedgerEntry,
  ContractorSettlement,
  ContractorCostRow,
  CreateSettlementInput,
  RecordAdvanceInput,
  UpdateContractorInput,
} from "../types";

const K = {
  contractors: "constructly.demo.contractors.v1",
  ledger: "constructly.demo.contractorLedger.v1",
  settlements: "constructly.demo.contractorSettlements.v1",
};
const LABOUR_ATTENDANCE = "constructly.demo.labourAttendance.v2";
const PROJECTS = "constructly.demo.projects.v1";
const CONTRACTS = "constructly.demo.contractorContracts.v2";

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

type ContractorRec = {
  id: string;
  name: string;
  phone: string | null;
  status: "ACTIVE" | "INACTIVE";
  openingAdvancePaise: number;
  createdAt: string;
};
type LedgerRec = ContractorLedgerEntry;
type SettlementRec = ContractorSettlement;

const SEED_CONTRACTORS: ContractorRec[] = [
  {
    id: "c-ramesh",
    name: "Ramesh Construction Crew",
    phone: "+91 98200 11223",
    status: "ACTIVE",
    openingAdvancePaise: 10_000_000,
    createdAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "c-suresh",
    name: "Suresh Masonry",
    phone: "+91 98200 44556",
    status: "ACTIVE",
    openingAdvancePaise: 0,
    createdAt: "2026-06-10T00:00:00.000Z",
  },
  {
    // Holds the seeded commercial agreements (see features/contracts/demo):
    // a ₹60,00,000 Structure package over six slabs, plus a second Compound Wall
    // agreement on the SAME project so multi-agreement isolation is visible.
    id: "c-pappu",
    name: "Pappu Contractor",
    phone: "+91 98200 77889",
    status: "ACTIVE",
    openingAdvancePaise: 0,
    createdAt: "2026-01-05T00:00:00.000Z",
  },
];
const SEED_LEDGER: LedgerRec[] = [
  {
    id: "l-open-ramesh",
    contractorId: "c-ramesh",
    date: "2026-06-01",
    type: "OPENING_ADVANCE",
    amountPaise: 10_000_000,
    advanceBalanceAfterPaise: 10_000_000,
    notes: "Opening advance",
    settlementId: null,
    projectId: null,
    contractId: null,
    contractTitle: null,
    drawsFromEntryId: null,
    reversesEntryId: null,
    fundsContractId: null,
    projectName: null,
    createdAt: "2026-06-01T00:00:00.000Z",
  },
  // Two advances for Pappu, deliberately scoped differently — together they show
  // the allocation hierarchy without needing a settlement to be run.
  {
    // PROJECT-scoped: carries no agreement claim, so it can fund any bucket on
    // Skyline — including the unattributed one, which is all that exists until
    // attendance becomes agreement-aware.
    id: "l-adv-pappu-project",
    contractorId: "c-pappu",
    date: "2026-01-20",
    type: "ADVANCE",
    amountPaise: 20_000_000,
    advanceBalanceAfterPaise: 20_000_000,
    notes: "Labour advance — Skyline",
    settlementId: null,
    projectId: "10000000-0000-0000-0000-000000000001",
    contractId: null,
    contractTitle: null,
    drawsFromEntryId: null,
    reversesEntryId: null,
    fundsContractId: null,
    projectName: "Skyline Residency",
    createdAt: "2026-01-20T00:00:00.000Z",
  },
  {
    // AGREEMENT-scoped: stays OUTSTANDING while attendance is unattributed. The
    // system will not spend Structure's money on labour it cannot prove was
    // Structure work — that week might genuinely be Compound Wall.
    id: "l-adv-pappu-structure",
    contractorId: "c-pappu",
    date: "2026-01-25",
    type: "ADVANCE",
    amountPaise: 50_000_000,
    advanceBalanceAfterPaise: 70_000_000,
    notes: "Labour advance — Structure agreement",
    settlementId: null,
    projectId: "10000000-0000-0000-0000-000000000001",
    contractId: "ag-structure",
    contractTitle: "Structure",
    drawsFromEntryId: null,
    reversesEntryId: null,
    fundsContractId: null,
    projectName: "Skyline Residency",
    createdAt: "2026-01-25T00:00:00.000Z",
  },
];

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

function loadContractors() {
  return read<ContractorRec>(K.contractors, SEED_CONTRACTORS);
}
function loadLedger() {
  return read<LedgerRec>(K.ledger, SEED_LEDGER);
}
function loadSettlements() {
  return read<SettlementRec>(K.settlements, []);
}

function balanceFor(contractorId: string): number {
  return advanceBalancePaise(loadLedger().filter((e) => e.contractorId === contractorId));
}

/** Parity with the server: an archived contractor takes on no new business. */
function assertAcceptsNewBusiness(
  rec: ContractorRec,
  action: Parameters<typeof newBusinessBlockedReason>[1],
): void {
  const blocked = newBusinessBlockedReason(rec.status, action, rec.name);
  if (blocked) throw new Error(`CONTRACTOR_ARCHIVED: ${blocked}`);
}

function toContractor(c: ContractorRec): Contractor {
  return { ...c, advanceBalancePaise: balanceFor(c.id) };
}

/** The attendance rows a settlement period covers, in storage shape. */
interface AttendanceRec {
  id: string;
  projectId: string;
  date: string;
  estimatedCostPaise: number;
  contractorId?: string | null;
  /** Agreement attribution — always null before Phase 6. */
  contractId?: string | null;
  /** The settlement that financially recognised this row. */
  settlementId?: string | null;
}

function loadAttendance(): AttendanceRec[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(LABOUR_ATTENDANCE) ?? "[]") as AttendanceRec[];
  } catch {
    return [];
  }
}
function writeAttendance(rows: AttendanceRec[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LABOUR_ATTENDANCE, JSON.stringify(rows));
  } catch {
    /* quota */
  }
}

/** The rows in one settlement window, whether or not they're already settled. */
function periodRows(
  rows: AttendanceRec[],
  contractorId: string,
  projectId: string,
  periodStart: string,
  periodEnd: string,
): AttendanceRec[] {
  return rows.filter(
    (r) =>
      r.contractorId === contractorId &&
      r.projectId === projectId &&
      r.date >= periodStart &&
      r.date <= periodEnd,
  );
}

/** Weekly bill from attributed demo attendance (0 until attendance is attributed). */
function demoLabourBill(
  contractorId: string,
  projectId: string,
  periodStart: string,
  periodEnd: string,
): number {
  return periodRows(loadAttendance(), contractorId, projectId, periodStart, periodEnd).reduce(
    (s, r) => s + (r.estimatedCostPaise ?? 0),
    0,
  );
}

/**
 * The composition of a period's labour, by agreement. Demo attendance carries no
 * `contractId`, so this is the single unattributed bucket — exactly the
 * pre-Phase-6 production shape, which is the point of the demo.
 */
function demoComposition(
  contractorId: string,
  projectId: string,
  periodStart: string,
  periodEnd: string,
  bill: number,
): BillComposition {
  const composition: BillComposition = new Map();
  for (const r of periodRows(loadAttendance(), contractorId, projectId, periodStart, periodEnd)) {
    const key = r.contractId ?? null;
    composition.set(key, (composition.get(key) ?? 0) + (r.estimatedCostPaise ?? 0));
  }
  if (composition.size === 0 && bill === 0) composition.set(null, 0);
  return composition;
}

/** Agreement id → title, so an unusable advance can name its scope. */
function contractTitles(): Map<string, string> {
  if (typeof window === "undefined") return new Map();
  try {
    const rows = JSON.parse(window.localStorage.getItem(CONTRACTS) ?? "[]") as {
      id: string;
      title: string;
    }[];
    return new Map(rows.map((c) => [c.id, c.title]));
  } catch {
    return new Map();
  }
}

/**
 * Everything a settlement needs to know before it writes anything: the bill, the
 * outstanding advances, what the labour consists of, and — crucially — how much
 * of that advance balance this particular period is actually allowed to draw on.
 */
function allocationState(input: {
  contractorId: string;
  projectId: string;
  periodStart: string;
  periodEnd: string;
}) {
  const bill = demoLabourBill(
    input.contractorId,
    input.projectId,
    input.periodStart,
    input.periodEnd,
  );
  const outstanding = balanceFor(input.contractorId);
  const composition = demoComposition(
    input.contractorId,
    input.projectId,
    input.periodStart,
    input.periodEnd,
    bill,
  );
  const advances = outstandingPerAdvance(
    loadLedger().filter((e) => e.contractorId === input.contractorId),
  );
  const atCeiling = allocateAdvanceDrawdown({
    outstanding: advances,
    requestedPaise: maxAdjustmentPaise(outstanding, bill),
    projectId: input.projectId,
    composition,
  });
  return {
    bill,
    outstanding,
    composition,
    advances,
    atCeiling,
    allocatablePaise: atCeiling.reduce((a, x) => a + x.amountPaise, 0),
  };
}

function demoProjectName(id: string): string {
  if (typeof window === "undefined") return "Project";
  try {
    const rows = JSON.parse(window.localStorage.getItem(PROJECTS) ?? "[]") as {
      id: string;
      name: string;
    }[];
    return rows.find((p) => p.id === id)?.name ?? "Project";
  } catch {
    return "Project";
  }
}

export const demoContractorsRepository: ContractorsRepository = {
  async listContractors(filters: ContractorFilters = {}) {
    let rows = loadContractors();
    if (filters.status && filters.status !== "ALL")
      rows = rows.filter((c) => c.status === filters.status);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter(
        (c) => c.name.toLowerCase().includes(q) || (c.phone ?? "").toLowerCase().includes(q),
      );
    }
    return rows
      .map(toContractor)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async getContractor(id) {
    const c = loadContractors().find((x) => x.id === id);
    return c ? toContractor(c) : null;
  },

  async findContractorDuplicates(candidate) {
    return findDuplicates(candidate, loadContractors());
  },

  async createContractor(input) {
    const rows = loadContractors();
    if (!input.allowDuplicate) {
      const duplicates = findDuplicates(input, rows);
      if (duplicates.length > 0) return { duplicates };
    }
    const rec: ContractorRec = {
      id: uid(),
      name: input.name,
      phone: input.phone ?? null,
      status: "ACTIVE",
      openingAdvancePaise: input.openingAdvancePaise ?? 0,
      createdAt: new Date().toISOString(),
    };
    rows.push(rec);
    write(K.contractors, rows);
    if (rec.openingAdvancePaise > 0) {
      const ledger = loadLedger();
      ledger.push({
        id: uid(),
        contractorId: rec.id,
        date: new Date().toISOString().slice(0, 10),
        type: "OPENING_ADVANCE",
        amountPaise: rec.openingAdvancePaise,
        advanceBalanceAfterPaise: rec.openingAdvancePaise,
        notes: "Opening advance",
        settlementId: null,
        projectId: null,
        contractId: null,
        contractTitle: null,
        drawsFromEntryId: null,
        reversesEntryId: null,
        fundsContractId: null,
        projectName: null,
        createdAt: new Date().toISOString(),
      });
      write(K.ledger, ledger);
    }
    return toContractor(rec);
  },

  async archiveContractor(id) {
    const rows = loadContractors();
    const rec = rows.find((c) => c.id === id);
    if (!rec) throw new Error("NOT_FOUND");
    if (rec.status === "INACTIVE") throw new Error("ALREADY_ARCHIVED");
    rec.status = "INACTIVE";
    write(K.contractors, rows);
    return toContractor(rec);
  },

  async restoreContractor(id) {
    const rows = loadContractors();
    const rec = rows.find((c) => c.id === id);
    if (!rec) throw new Error("NOT_FOUND");
    if (rec.status === "ACTIVE") throw new Error("NOT_ARCHIVED");
    rec.status = "ACTIVE";
    write(K.contractors, rows);
    return toContractor(rec);
  },

  async updateContractor(id, patch: UpdateContractorInput) {
    const rows = loadContractors();
    const i = rows.findIndex((c) => c.id === id);
    if (i === -1) throw new Error("NOT_FOUND");
    rows[i] = {
      ...rows[i],
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone?.trim() || null } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    };
    write(K.contractors, rows);
    return toContractor(rows[i]);
  },

  async recordAdvance(input: RecordAdvanceInput) {
    const contractor = loadContractors().find((x) => x.id === input.contractorId);
    if (!contractor) throw new Error("NOT_FOUND");
    assertAcceptsNewBusiness(contractor, "RECORD_ADVANCE");
    const ledger = loadLedger();
    const balance = balanceFor(input.contractorId) + input.amountPaise;
    const entry: LedgerRec = {
      id: uid(),
      contractorId: input.contractorId,
      date: input.date,
      type: "ADVANCE",
      amountPaise: input.amountPaise,
      advanceBalanceAfterPaise: balance,
      notes: input.notes ?? null,
      settlementId: null,
      // A LABOUR ADVANCE may be scoped so the money keeps its commercial owner.
      // An agreement-scoped advance is only ever consumed by a settlement whose
      // composition contains that agreement.
      projectId: input.projectId ?? null,
      contractId: input.contractId ?? null,
      contractTitle: null,
      drawsFromEntryId: null,
      reversesEntryId: null,
      fundsContractId: null,
      projectName: null,
      createdAt: new Date().toISOString(),
    };
    write(K.ledger, [...ledger, entry]);
    return entry;
  },

  async reverseSettlement(settlementId, reason) {
    const trimmed = reason.trim();
    if (!trimmed) throw new Error("REVERSAL_REASON_REQUIRED");

    const settlements = loadSettlements();
    const settlement = settlements.find((x) => x.id === settlementId);
    if (!settlement) throw new Error("NOT_FOUND");
    if (settlement.reversedAt) throw new Error("SETTLEMENT_ALREADY_REVERSED");

    const ledger = loadLedger();
    const now = new Date().toISOString();
    let bal = balanceFor(settlement.contractorId);

    const entry = (over: Partial<LedgerRec> & { amountPaise: number }): LedgerRec => ({
      id: uid(),
      contractorId: settlement.contractorId,
      date: now.slice(0, 10),
      type: "SETTLEMENT_REVERSAL",
      advanceBalanceAfterPaise: 0,
      notes: null,
      settlementId,
      projectId: settlement.projectId,
      contractId: null,
      contractTitle: null,
      drawsFromEntryId: null,
      reversesEntryId: null,
      fundsContractId: null,
      projectName: settlement.projectName,
      createdAt: now,
      ...over,
    });

    // 1. Restore each drawdown to the advance it came from.
    let restored = 0;
    for (const adj of ledger.filter((e) => e.settlementId === settlementId && e.type === "ADJUSTMENT")) {
      if (adj.amountPaise <= 0) continue;
      bal += adj.amountPaise;
      restored += adj.amountPaise;
      ledger.push(
        entry({
          amountPaise: adj.amountPaise,
          advanceBalanceAfterPaise: bal,
          projectId: adj.projectId,
          contractId: adj.contractId,
          reversesEntryId: adj.id,
          notes: "Drawdown restored on settlement reversal",
        }),
      );
    }

    // 2. Un-apply the cash already paid, per composition bucket. The demo has a
    // single unattributed bucket (attendance carries no contractId yet), which is
    // exactly the pre-Phase-6 production shape.
    const net = settlement.netPaymentPaise;
    if (net > 0) {
      bal += net;
      ledger.push(
        entry({
          amountPaise: net,
          advanceBalanceAfterPaise: bal,
          notes: "Net payment unapplied on settlement reversal",
        }),
      );
    }

    if (restored + net !== settlement.labourBillPaise) throw new Error("REVERSAL_IMBALANCE");
    write(K.ledger, ledger);

    // Free the attendance this settlement owned, so a mistyped headcount can be
    // corrected and the period re-settled. Nothing is deleted.
    const attendance = loadAttendance();
    for (const r of attendance) if (r.settlementId === settlementId) r.settlementId = null;
    writeAttendance(attendance);

    settlement.reversedAt = now;
    settlement.reversalReason = trimmed;
    write(K.settlements, settlements);
    return settlement;
  },

  async getLedger(contractorId) {
    const c = loadContractors().find((x) => x.id === contractorId);
    if (!c) throw new Error("NOT_FOUND");
    const entries = loadLedger()
      .filter((e) => e.contractorId === contractorId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    // Demo mode runs as a single full-access company, so the visible entries
    // ARE every entry and the fold matches the authoritative balance.
    return {
      contractor: toContractor(c),
      entries,
      // Demo runs as a single full-access company: every entry is visible, so
      // the balance is the authoritative one.
      scope: "COMPANY" as const,
      isPartial: false,
      hiddenEntryCount: 0,
    };
  },

  async previewSettlement(input: SettlementPreviewInput) {
    const s = allocationState(input);
    const math = computeSettlement(
      s.bill,
      Math.min(Math.max(0, Math.round(input.advanceAdjustmentPaise)), s.allocatablePaise),
      s.outstanding,
    );
    const titles = contractTitles();
    return {
      labourBillPaise: s.bill,
      outstandingAdvancePaise: s.outstanding,
      // What can ACTUALLY be drawn — an agreement-scoped advance is excluded
      // while this period's labour has no claim on that agreement.
      maxAdjustmentPaise: s.allocatablePaise,
      advanceAdjustmentPaise: math.advanceAdjustmentPaise,
      netPaymentPaise: math.netPaymentPaise,
      advanceBalanceAfterPaise: math.advanceBalanceAfterPaise,
      unusableAdvances: unusableAdvances({
        outstanding: s.advances,
        allocations: s.atCeiling,
        projectId: input.projectId,
        composition: s.composition,
      }).map((u) => ({
        ...u,
        contractTitle: u.contractId ? (titles.get(u.contractId) ?? null) : null,
      })),
    };
  },

  async createSettlement(input: CreateSettlementInput) {
    const c = loadContractors().find((x) => x.id === input.contractorId);
    if (!c) throw new Error("NOT_FOUND");
    // No archived check — parity with the server. A settlement closes out
    // attendance already recorded, so archiving must not strand it. New
    // attendance is what stops (see labor/demo/demo-repository.ts).

    const attendance = loadAttendance();
    const rows = periodRows(
      attendance,
      input.contractorId,
      input.projectId,
      input.periodStart,
      input.periodEnd,
    );
    // OVERLAP GUARD (parity with the server): the same labour must never be
    // recognised by two settlements. The bill sums the whole period, so quietly
    // settling "just the unsettled part" would re-bill money already paid.
    const settled = rows.filter((r) => r.settlementId != null);
    if (settled.length > 0) {
      throw new Error(
        `SETTLEMENT_PERIOD_OVERLAPS: ${settled.length} attendance record` +
          `${settled.length === 1 ? "" : "s"} in ${input.periodStart} – ${input.periodEnd} ` +
          `${settled.length === 1 ? "has" : "have"} already been settled. Reverse that ` +
          `settlement first, or choose a later period.`,
      );
    }

    const s = allocationState(input);
    const err = validateAdjustment(input.advanceAdjustmentPaise, s.outstanding, s.bill);
    if (err) throw new Error(err);
    const math = computeSettlement(s.bill, input.advanceAdjustmentPaise, s.outstanding);

    const allocations = allocateAdvanceDrawdown({
      outstanding: s.advances,
      requestedPaise: math.advanceAdjustmentPaise,
      projectId: input.projectId,
      composition: s.composition,
    });
    const allocated = allocations.reduce((a, x) => a + x.amountPaise, 0);
    if (allocated !== math.advanceAdjustmentPaise) {
      throw new Error(
        `ADVANCE_NOT_ALLOCATABLE: only ${allocated} of the requested ` +
          `${math.advanceAdjustmentPaise} paise could be drawn from advances ` +
          `eligible for this period's labour.`,
      );
    }

    const projectName = demoProjectName(input.projectId);
    const now = new Date().toISOString();
    const settlement: SettlementRec = {
      id: uid(),
      contractorId: input.contractorId,
      contractorName: c.name,
      projectId: input.projectId,
      projectName,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      labourBillPaise: s.bill,
      advanceAdjustmentPaise: math.advanceAdjustmentPaise,
      netPaymentPaise: math.netPaymentPaise,
      advanceBalanceAfterPaise: math.advanceBalanceAfterPaise,
      notes: input.notes ?? null,
      createdAt: now,
    };
    write(K.settlements, [...loadSettlements(), settlement]);

    const ledger = loadLedger();
    const base = {
      contractorId: input.contractorId,
      date: input.periodEnd,
      notes: null,
      settlementId: settlement.id,
      projectId: null,
      contractId: null,
      contractTitle: null,
      drawsFromEntryId: null,
      reversesEntryId: null,
      fundsContractId: null,
      projectName,
      createdAt: now,
    };
    let bal = s.outstanding;
    ledger.push({ ...base, id: uid(), type: "LABOUR_BILL", amountPaise: s.bill, advanceBalanceAfterPaise: bal });
    // One ADJUSTMENT per allocation, carrying BOTH the advance consumed and the
    // bucket it funded — they differ whenever a project or legacy advance pays
    // for an agreement's share.
    for (const a of allocations) {
      bal -= a.amountPaise;
      ledger.push({
        ...base,
        id: uid(),
        type: "ADJUSTMENT",
        amountPaise: a.amountPaise,
        advanceBalanceAfterPaise: bal,
        projectId: a.projectId,
        contractId: a.contractId,
        drawsFromEntryId: a.entryId,
        fundsContractId: a.fundsContractId,
      });
    }
    ledger.push({ ...base, id: uid(), type: "PAYMENT", amountPaise: math.netPaymentPaise, advanceBalanceAfterPaise: bal });
    write(K.ledger, ledger);

    // Stamp the attendance this settlement recognised. Once stamped a row is
    // financially immutable — the labour repo refuses to edit or clear it.
    for (const r of rows) r.settlementId = settlement.id;
    writeAttendance(attendance);

    return settlement;
  },

  async listSettlements(filters: SettlementFilters = {}) {
    return loadSettlements()
      .filter(
        (s) =>
          (!filters.contractorId || s.contractorId === filters.contractorId) &&
          (!filters.projectId || s.projectId === filters.projectId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async outstandingAdvances() {
    return loadContractors()
      .map(toContractor)
      .filter((c) => c.advanceBalancePaise > 0)
      .map((c) => ({
        contractorId: c.id,
        name: c.name,
        phone: c.phone,
        advanceBalancePaise: c.advanceBalancePaise,
      }))
      .sort((a, b) => b.advanceBalancePaise - a.advanceBalancePaise);
  },

  async contractorCostSummary(): Promise<ContractorCostRow[]> {
    const settlements = loadSettlements();
    return loadContractors()
      .map(toContractor)
      .map((c) => {
        // Reversed settlements are excluded here exactly as they are on the
        // server — they keep their record but count towards nothing.
        const mine = settlements.filter((s) => s.contractorId === c.id && !s.reversedAt);
        return {
          contractorId: c.id,
          name: c.name,
          totalBillPaise: mine.reduce((s, x) => s + x.labourBillPaise, 0),
          totalPaidPaise: mine.reduce((s, x) => s + x.netPaymentPaise, 0),
          totalAdjustedPaise: mine.reduce((s, x) => s + x.advanceAdjustmentPaise, 0),
          advanceBalancePaise: c.advanceBalancePaise,
          settlementCount: mine.length,
        };
      });
  },
};
