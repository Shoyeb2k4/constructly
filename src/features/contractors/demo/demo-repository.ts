import { advanceBalancePaise, computeSettlement, validateAdjustment } from "../calc";
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
  CreateContractorInput,
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
    projectName: null,
    createdAt: "2026-06-01T00:00:00.000Z",
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

function toContractor(c: ContractorRec): Contractor {
  return { ...c, advanceBalancePaise: balanceFor(c.id) };
}

/** Weekly bill from attributed demo attendance (0 until attendance is attributed). */
function demoLabourBill(
  contractorId: string,
  projectId: string,
  periodStart: string,
  periodEnd: string,
): number {
  if (typeof window === "undefined") return 0;
  try {
    const rows = JSON.parse(window.localStorage.getItem(LABOUR_ATTENDANCE) ?? "[]") as {
      projectId: string;
      date: string;
      estimatedCostPaise: number;
      contractorId?: string | null;
    }[];
    return rows
      .filter(
        (r) =>
          r.contractorId === contractorId &&
          r.projectId === projectId &&
          r.date >= periodStart &&
          r.date <= periodEnd,
      )
      .reduce((s, r) => s + (r.estimatedCostPaise ?? 0), 0);
  } catch {
    return 0;
  }
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

  async createContractor(input: CreateContractorInput) {
    const rows = loadContractors();
    const rec: ContractorRec = {
      id: uid(),
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      status: "ACTIVE",
      openingAdvancePaise: input.openingAdvancePaise ?? 0,
      createdAt: new Date().toISOString(),
    };
    write(K.contractors, [...rows, rec]);
    if (rec.openingAdvancePaise > 0) {
      const ledger = loadLedger();
      ledger.push({
        id: uid(),
        contractorId: rec.id,
        date: rec.createdAt.slice(0, 10),
        type: "OPENING_ADVANCE",
        amountPaise: rec.openingAdvancePaise,
        advanceBalanceAfterPaise: rec.openingAdvancePaise,
        notes: "Opening advance",
        settlementId: null,
        projectName: null,
        createdAt: rec.createdAt,
      });
      write(K.ledger, ledger);
    }
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
      projectName: null,
      createdAt: new Date().toISOString(),
    };
    write(K.ledger, [...ledger, entry]);
    return entry;
  },

  async getLedger(contractorId) {
    const c = loadContractors().find((x) => x.id === contractorId);
    if (!c) throw new Error("NOT_FOUND");
    const entries = loadLedger()
      .filter((e) => e.contractorId === contractorId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { contractor: toContractor(c), entries };
  },

  async previewSettlement(input: SettlementPreviewInput) {
    const bill = demoLabourBill(
      input.contractorId,
      input.projectId,
      input.periodStart,
      input.periodEnd,
    );
    const outstanding = balanceFor(input.contractorId);
    const math = computeSettlement(bill, input.advanceAdjustmentPaise, outstanding);
    return {
      labourBillPaise: bill,
      outstandingAdvancePaise: outstanding,
      maxAdjustmentPaise: Math.max(0, Math.min(outstanding, bill)),
      advanceAdjustmentPaise: math.advanceAdjustmentPaise,
      netPaymentPaise: math.netPaymentPaise,
      advanceBalanceAfterPaise: math.advanceBalanceAfterPaise,
    };
  },

  async createSettlement(input: CreateSettlementInput) {
    const c = loadContractors().find((x) => x.id === input.contractorId);
    if (!c) throw new Error("NOT_FOUND");
    const bill = demoLabourBill(
      input.contractorId,
      input.projectId,
      input.periodStart,
      input.periodEnd,
    );
    const outstanding = balanceFor(input.contractorId);
    const err = validateAdjustment(input.advanceAdjustmentPaise, outstanding, bill);
    if (err) throw new Error(err);
    const math = computeSettlement(bill, input.advanceAdjustmentPaise, outstanding);
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
      labourBillPaise: bill,
      advanceAdjustmentPaise: math.advanceAdjustmentPaise,
      netPaymentPaise: math.netPaymentPaise,
      advanceBalanceAfterPaise: math.advanceBalanceAfterPaise,
      notes: input.notes ?? null,
      createdAt: now,
    };
    write(K.settlements, [...loadSettlements(), settlement]);

    const ledger = loadLedger();
    let bal = outstanding;
    ledger.push({
      id: uid(),
      contractorId: input.contractorId,
      date: input.periodEnd,
      type: "LABOUR_BILL",
      amountPaise: bill,
      advanceBalanceAfterPaise: bal,
      notes: null,
      settlementId: settlement.id,
      projectName,
      createdAt: now,
    });
    if (math.advanceAdjustmentPaise > 0) {
      bal -= math.advanceAdjustmentPaise;
      ledger.push({
        id: uid(),
        contractorId: input.contractorId,
        date: input.periodEnd,
        type: "ADJUSTMENT",
        amountPaise: math.advanceAdjustmentPaise,
        advanceBalanceAfterPaise: bal,
        notes: null,
        settlementId: settlement.id,
        projectName,
        createdAt: now,
      });
    }
    ledger.push({
      id: uid(),
      contractorId: input.contractorId,
      date: input.periodEnd,
      type: "PAYMENT",
      amountPaise: math.netPaymentPaise,
      advanceBalanceAfterPaise: bal,
      notes: null,
      settlementId: settlement.id,
      projectName,
      createdAt: now,
    });
    write(K.ledger, ledger);
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
        const mine = settlements.filter((s) => s.contractorId === c.id);
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
