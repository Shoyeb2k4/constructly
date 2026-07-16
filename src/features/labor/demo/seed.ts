import { toPaise } from "@/lib/money";
import { DEFAULT_CATEGORIES } from "../constants";

export interface CategoryRecord {
  id: string;
  name: string;
  color: string;
  dailyRatePaise: number | null;
}

export interface LabourAttendanceRecord {
  id: string;
  projectId: string;
  date: string; // YYYY-MM-DD
  labourCategoryId: string;
  quantityPresent: number;
  notes: string | null;
  clientUuid: string;
  updatedAt: string;
}

const SKYLINE = "10000000-0000-0000-0000-000000000001";
const ORION = "10000000-0000-0000-0000-000000000002";

export const DEMO_CATEGORIES: CategoryRecord[] = DEFAULT_CATEGORIES.map((c, i) => ({
  id: `60000000-0000-0000-0000-0000000000${String(i + 1).padStart(2, "0")}`,
  name: c.name,
  color: c.color,
  dailyRatePaise: toPaise(c.dailyRateRupees),
}));

const ymd = (offset: number) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return d.toISOString().slice(0, 10);
};
const isWeekend = (iso: string) => {
  const dow = new Date(iso + "T00:00:00Z").getUTCDay();
  return dow === 0 || dow === 6;
};

// Typical crew sizes per category on Skyline (deterministic variance).
const SKYLINE_BASE = [12, 8, 4, 3, 2, 0, 5, 1]; // matches DEFAULT_CATEGORIES order
const ORION_BASE = [6, 3, 0, 2, 0, 0, 4, 1];

/** Seed the last ~3 working weeks; today is left blank for the live demo. */
export function demoLabourAttendance(): LabourAttendanceRecord[] {
  const records: LabourAttendanceRecord[] = [];
  for (let offset = -21; offset <= -1; offset++) {
    const date = ymd(offset);
    if (isWeekend(date)) continue;
    DEMO_CATEGORIES.forEach((cat, i) => {
      const wobble = ((offset * 7 + i * 3) % 5) - 2; // -2..+2, deterministic
      const skyQty = Math.max(0, SKYLINE_BASE[i] + wobble);
      if (skyQty > 0) {
        records.push({
          id: `sky-${cat.id}-${date}`,
          projectId: SKYLINE,
          date,
          labourCategoryId: cat.id,
          quantityPresent: skyQty,
          notes: null,
          clientUuid: `seed-sky-${cat.id}-${date}`,
          updatedAt: new Date().toISOString(),
        });
      }
      if (offset >= -10) {
        const orionQty = Math.max(0, ORION_BASE[i] + (wobble % 2));
        if (orionQty > 0) {
          records.push({
            id: `ori-${cat.id}-${date}`,
            projectId: ORION,
            date,
            labourCategoryId: cat.id,
            quantityPresent: orionQty,
            notes: null,
            clientUuid: `seed-ori-${cat.id}-${date}`,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    });
  }
  return records;
}
