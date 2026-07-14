import type { AttendanceStatus, ContractorStatus, LaborerStatus } from "../types";
import { computeWage } from "../wage";
import { toPaise } from "@/lib/money";

export interface ContractorRecord {
  id: string;
  name: string;
  phone: string | null;
  status: ContractorStatus;
}

export interface LaborerRecord {
  id: string;
  fullName: string;
  phone: string | null;
  trade: string;
  dailyWagePaise: number;
  contractorId: string | null;
  status: LaborerStatus;
  notes: string | null;
}

export interface AttendanceRecord {
  id: string;
  projectId: string;
  laborerId: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  otHours: number;
  wageRatePaise: number;
  wagePayablePaise: number;
  recordedByName: string;
  clientUuid: string;
  updatedAt: string;
}

const C1 = "20000000-0000-0000-0000-0000000000c1";
const C2 = "20000000-0000-0000-0000-0000000000c2";
const SKYLINE = "10000000-0000-0000-0000-000000000001";

export const DEMO_CONTRACTORS: ContractorRecord[] = [
  { id: C1, name: "Sharma & Co.", phone: "+919845098001", status: "ACTIVE" },
  { id: C2, name: "Reliable Labour Contractors", phone: "+919845098002", status: "ACTIVE" },
];

function lab(
  n: number,
  fullName: string,
  trade: string,
  wage: number,
  contractorId: string | null,
  status: LaborerStatus = "ACTIVE",
): LaborerRecord {
  return {
    id: `30000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`,
    fullName,
    phone: null,
    trade,
    dailyWagePaise: toPaise(wage),
    contractorId,
    status,
    notes: null,
  };
}

export const DEMO_LABORERS: LaborerRecord[] = [
  lab(1, "Ramesh Kumar", "Mason", 850, null),
  lab(2, "Suresh Yadav", "Helper", 550, null),
  lab(3, "Anil Sharma", "Electrician", 1100, C1),
  lab(4, "Prakash Patil", "Carpenter", 900, null),
  lab(5, "Mahesh Singh", "Steel Fixer", 800, C2),
  lab(6, "Vijay Reddy", "Plumber", 950, C1),
  lab(7, "Ganesh Rao", "Helper", 550, C2),
  lab(8, "Dinesh Kumar", "Painter", 700, null),
  lab(9, "Sanjay Gupta", "Welder", 1000, C1),
  lab(10, "Rakesh Jha", "Mason", 850, null),
  lab(11, "Kiran Kumar", "Operator", 1200, C2),
  lab(12, "Manoj Verma", "Supervisor", 1500, null, "INACTIVE"),
];

const ymd = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** Seed a crew for Skyline over the last two days (today left blank to fill). */
export function demoAttendance(): AttendanceRecord[] {
  const crew = DEMO_LABORERS.slice(0, 8); // 8-worker crew
  const records: AttendanceRecord[] = [];
  for (const offset of [-1, -2]) {
    const date = ymd(offset);
    crew.forEach((l, i) => {
      // A couple of exceptions for realism.
      const status: AttendanceStatus =
        i === 2 && offset === -1 ? "ABSENT" : i === 6 ? "HALF_DAY" : "PRESENT";
      const ot = i === 0 && offset === -1 ? 2 : 0;
      const { wageRatePaise, wagePayablePaise } = computeWage(l.dailyWagePaise, status, ot);
      records.push({
        id: `${l.id}-${date}`,
        projectId: SKYLINE,
        laborerId: l.id,
        date,
        status,
        otHours: ot,
        wageRatePaise,
        wagePayablePaise,
        recordedByName: "Priya Nair",
        clientUuid: `seed-${l.id}-${date}`,
        updatedAt: new Date().toISOString(),
      });
    });
  }
  return records;
}
