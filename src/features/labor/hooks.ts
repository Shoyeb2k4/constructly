"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { laborApi, laborKeys } from "./data";
import type { DateRange } from "./repository";
import { computeWage } from "./wage";
import type {
  AttendanceSheet,
  AttendanceStatus,
  CreateContractorInput,
  CreateLaborerInput,
  LaborerStatus,
  LaborFilters,
  UpdateLaborerInput,
} from "./types";

/* ── Queries ─────────────────────────────────────────────────────────── */

export function useLaborers(filters: LaborFilters = {}) {
  return useQuery({ queryKey: laborKeys.laborers(filters), queryFn: () => laborApi.listLaborers(filters) });
}
export function useTrades() {
  return useQuery({ queryKey: laborKeys.trades, queryFn: () => laborApi.listTrades(), staleTime: 5 * 60_000 });
}
export function useContractors() {
  return useQuery({ queryKey: laborKeys.contractors, queryFn: () => laborApi.listContractors() });
}
export function useAttendanceSheet(projectId: string | null, date: string) {
  return useQuery({
    queryKey: laborKeys.sheet(projectId ?? "none", date),
    queryFn: () => laborApi.getSheet(projectId!, date),
    enabled: !!projectId,
  });
}
export function useLaborCostByProject(range: DateRange) {
  return useQuery({ queryKey: laborKeys.costByProject(range), queryFn: () => laborApi.laborCostByProject(range) });
}
export function useLaborCostByContractor(range: DateRange) {
  return useQuery({ queryKey: laborKeys.costByContractor(range), queryFn: () => laborApi.laborCostByContractor(range) });
}

/* ── Attendance mutations (optimistic — taps feel instant) ───────────── */

function recompute(sheet: AttendanceSheet): AttendanceSheet {
  const c = sheet.cells;
  return {
    ...sheet,
    summary: {
      present: c.filter((x) => x.status === "PRESENT").length,
      half: c.filter((x) => x.status === "HALF_DAY").length,
      absent: c.filter((x) => x.status === "ABSENT").length,
      unmarked: c.filter((x) => x.status == null).length,
      crew: c.length,
      totalWagePaise: c.reduce((s, x) => s + x.wagePayablePaise, 0),
    },
  };
}

export function useSetAttendance(projectId: string, date: string) {
  const qc = useQueryClient();
  const key = laborKeys.sheet(projectId, date);
  return useMutation({
    mutationFn: (v: { laborerId: string; status: AttendanceStatus | null; otHours: number }) =>
      laborApi.setAttendance(projectId, v.laborerId, date, v.status, v.otHours),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<AttendanceSheet>(key);
      if (prev) {
        qc.setQueryData<AttendanceSheet>(
          key,
          recompute({
            ...prev,
            cells: prev.cells.map((cell) =>
              cell.laborerId === v.laborerId
                ? {
                    ...cell,
                    status: v.status,
                    otHours: v.otHours,
                    wagePayablePaise: computeWage(cell.dailyWagePaise, v.status, v.otHours)
                      .wagePayablePaise,
                    syncState: "pending",
                  }
                : cell,
            ),
          }),
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error("Couldn't save — will retry");
    },
    onSuccess: (sheet) => qc.setQueryData(key, sheet),
    onSettled: () => qc.invalidateQueries({ queryKey: laborKeys.all }),
  });
}

export function useSheetActions(projectId: string, date: string) {
  const qc = useQueryClient();
  const key = laborKeys.sheet(projectId, date);
  const write = (sheet: AttendanceSheet) => qc.setQueryData(key, sheet);

  const markAllPresent = useMutation({
    mutationFn: () => laborApi.markAllPresent(projectId, date),
    onSuccess: (s) => {
      write(s);
      toast.success("Marked all present");
    },
  });
  const copyYesterday = useMutation({
    mutationFn: () => laborApi.copyYesterday(projectId, date),
    onSuccess: (s) => {
      write(s);
      toast.success("Copied from last working day");
    },
  });
  const addToCrew = useMutation({
    mutationFn: (laborerIds: string[]) => laborApi.addToCrew(projectId, laborerIds, date),
    onSuccess: write,
  });

  return { markAllPresent, copyYesterday, addToCrew };
}

/* ── Roster & contractor mutations ───────────────────────────────────── */

export function useLaborerMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: laborKeys.all });

  const create = useMutation({
    mutationFn: (input: CreateLaborerInput) => laborApi.createLaborer(input),
    onSuccess: (l) => {
      invalidate();
      toast.success("Worker added", { description: l.fullName });
    },
  });
  const update = useMutation({
    mutationFn: (v: { id: string; patch: UpdateLaborerInput }) => laborApi.updateLaborer(v.id, v.patch),
    onSuccess: () => {
      invalidate();
      toast.success("Saved");
    },
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: LaborerStatus }) => laborApi.setLaborerStatus(v.id, v.status),
    onSuccess: () => invalidate(),
  });
  const bulkStatus = useMutation({
    mutationFn: (v: { ids: string[]; status: LaborerStatus }) =>
      laborApi.bulkSetLaborerStatus(v.ids, v.status),
    onSuccess: (_r, v) => {
      invalidate();
      toast.success(`${v.ids.length} worker${v.ids.length > 1 ? "s" : ""} ${v.status === "INACTIVE" ? "deactivated" : "activated"}`);
    },
  });

  return { create, update, setStatus, bulkStatus };
}

export function useContractorMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: laborKeys.all });
  const create = useMutation({
    mutationFn: (input: CreateContractorInput) => laborApi.createContractor(input),
    onSuccess: (c) => {
      invalidate();
      toast.success("Contractor added", { description: c.name });
    },
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: "ACTIVE" | "INACTIVE" }) =>
      laborApi.setContractorStatus(v.id, v.status),
    onSuccess: () => invalidate(),
  });
  return { create, setStatus };
}
