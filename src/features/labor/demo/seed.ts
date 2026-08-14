import { toPaise } from "@/lib/money";
import { DEFAULT_HIERARCHY } from "../constants";

export interface CategoryRecord {
  id: string;
  name: string;
  color: string | null;
  displayOrder: number;
  /** Owner Force Delete soft-delete marker (ISO). Absent/null ⇒ active. Kept so
   *  historical attendance still resolves the name (parity with the server). */
  deletedAt?: string | null;
}

export interface SubcategoryRecord {
  id: string;
  categoryId: string;
  name: string;
  dailyRatePaise: number | null;
  displayOrder: number;
  /** Soft-delete marker (ISO). Absent/null ⇒ active. */
  deletedAt?: string | null;
}

export interface LabourAttendanceRecord {
  id: string;
  projectId: string;
  date: string; // YYYY-MM-DD
  labourSubcategoryId: string;
  quantityPresent: number;
  /** Rate snapshot at record time — immutable history (ADR-0022). */
  dailyRatePaiseSnapshot: number | null;
  estimatedCostPaise: number;
  notes: string | null;
  /** Optional contractor attribution for weekly settlement. */
  contractorId?: string | null;
  /**
   * The commercial agreement this labour belongs to. Part of the row IDENTITY:
   * one contractor holding two agreements on a project records the same labour
   * type on the same date under each, and neither may overwrite the other.
   * null = attendance-only, the legacy path, still fully supported.
   */
  contractId?: string | null;
  /**
   * The settlement that financially recognised this row. Once set the row is
   * immutable — settlement is the canonical recognition of attendance money, so
   * editing recognised value behind a settlement's back is refused. A governed
   * settlement reversal clears it again.
   */
  settlementId?: string | null;
  clientUuid: string;
  updatedAt: string;
}

const SKYLINE = "10000000-0000-0000-0000-000000000001";
const ORION = "10000000-0000-0000-0000-000000000002";

export const DEMO_CATEGORIES: CategoryRecord[] = DEFAULT_HIERARCHY.map((c, i) => ({
  id: `6c000000-0000-0000-0000-0000000000${String(i + 1).padStart(2, "0")}`,
  name: c.name,
  color: c.color,
  displayOrder: i,
}));

export const DEMO_SUBCATEGORIES: SubcategoryRecord[] = DEFAULT_HIERARCHY.flatMap((c, ci) =>
  c.subcategories.map((s, si) => ({
    id: `65000000-0000-0000-0000-0000000000${String(ci * 2 + si + 1).padStart(2, "0")}`,
    categoryId: DEMO_CATEGORIES[ci].id,
    name: s.name,
    dailyRatePaise: toPaise(s.dailyRateRupees),
    displayOrder: si,
  })),
);

const ymd = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const isWeekend = (iso: string) => {
  const dow = new Date(iso + "T00:00:00Z").getUTCDay();
  return dow === 0 || dow === 6;
};

// Typical crew sizes per subcategory (index-aligned with DEMO_SUBCATEGORIES).
const SKYLINE_BASE = [4, 6, 3, 3, 8, 5, 2, 3, 2, 2];
const ORION_BASE = [2, 3, 1, 2, 4, 3, 0, 0, 1, 1];

/** Seed the last ~3 working weeks; today is left blank for the live demo. */
export function demoLabourAttendance(): LabourAttendanceRecord[] {
  const records: LabourAttendanceRecord[] = [];
  for (let offset = -21; offset <= -1; offset++) {
    const date = ymd(offset);
    if (isWeekend(date)) continue;
    DEMO_SUBCATEGORIES.forEach((sub, i) => {
      const wobble = ((offset * 7 + i * 3) % 3) - 1; // -1..+1, deterministic
      const push = (projectId: string, base: number, tag: string) => {
        const qty = Math.max(0, base + wobble);
        if (qty <= 0) return;
        records.push({
          id: `${tag}-${sub.id}-${date}`,
          projectId,
          date,
          labourSubcategoryId: sub.id,
          quantityPresent: qty,
          dailyRatePaiseSnapshot: sub.dailyRatePaise,
          estimatedCostPaise: (sub.dailyRatePaise ?? 0) * qty,
          notes: null,
          clientUuid: `seed-${tag}-${sub.id}-${date}`,
          updatedAt: new Date().toISOString(),
        });
      };
      push(SKYLINE, SKYLINE_BASE[i], "sky");
      if (offset >= -10) push(ORION, ORION_BASE[i], "ori");
    });
  }
  records.push(...pappuSkylineWeek());
  return records;
}

/* ── Pappu's settlement week on Skyline ─────────────────────────────────── */

const PAPPU = "c-pappu";
const MASON = "65000000-0000-0000-0000-000000000005";
const MASON_HELPER = "65000000-0000-0000-0000-000000000006";

/** Contractor-specific rates — above the shared defaults, which is the whole
 *  point of putting a rate on the agreement rather than on the labour type. */
export const PAPPU_SKYLINE_RATES = {
  [MASON]: toPaise(1_000),
  [MASON_HELPER]: toPaise(500),
} as const;

/**
 * One settleable week of Pappu's labour on Skyline, sized to an exact
 * ₹6,00,000 bill so the settlement → reversal → correction cycle is walkable.
 *
 * The most recent day deliberately records 180 masons where 80 turned up — the
 * mistyped headcount the correction workflow exists for. Fixing it to 80 brings
 * the week to exactly ₹5,00,000.
 *
 * Weekends are NOT skipped here: the rows must sit inside the settlement sheet's
 * default seven-day window whichever day the demo is opened.
 */
function pappuSkylineWeek(): LabourAttendanceRecord[] {
  const rows: LabourAttendanceRecord[] = [];
  const masonRate = PAPPU_SKYLINE_RATES[MASON];
  const helperRate = PAPPU_SKYLINE_RATES[MASON_HELPER];

  for (let offset = -6; offset <= -2; offset++) {
    const date = ymd(offset);
    const masons = offset === -2 ? 180 : 80; // ← the mistyped day
    rows.push(
      {
        id: `pappu-mason-${date}`,
        projectId: SKYLINE,
        date,
        labourSubcategoryId: MASON,
        quantityPresent: masons,
        dailyRatePaiseSnapshot: masonRate,
        estimatedCostPaise: masonRate * masons,
        notes: null,
        contractorId: PAPPU,
        settlementId: null,
        clientUuid: `seed-pappu-mason-${date}`,
        updatedAt: new Date().toISOString(),
      },
      {
        id: `pappu-helper-${date}`,
        projectId: SKYLINE,
        date,
        labourSubcategoryId: MASON_HELPER,
        quantityPresent: 40,
        dailyRatePaiseSnapshot: helperRate,
        estimatedCostPaise: helperRate * 40,
        notes: null,
        contractorId: PAPPU,
        settlementId: null,
        clientUuid: `seed-pappu-helper-${date}`,
        updatedAt: new Date().toISOString(),
      },
    );
  }
  return rows;
}
