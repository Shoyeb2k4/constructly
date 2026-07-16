"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { laborApi, laborKeys } from "./data";
import { sheetTotals } from "./calc";
import type {
  AttendanceFilters,
  AttendanceSheet,
  CreateCategoryInput,
  UpdateCategoryInput,
} from "./types";

/* ── Queries ─────────────────────────────────────────────────────────── */

export function useCategories() {
  return useQuery({ queryKey: laborKeys.categories, queryFn: () => laborApi.listCategories() });
}
export function useAttendanceSheet(projectId: string | null, date: string) {
  return useQuery({
    queryKey: laborKeys.sheet(projectId ?? "none", date),
    queryFn: () => laborApi.getSheet(projectId!, date),
    enabled: !!projectId,
  });
}
export function useAttendanceList(filters: AttendanceFilters) {
  return useQuery({ queryKey: laborKeys.attendance(filters), queryFn: () => laborApi.listAttendance(filters) });
}
export function useLabourSummary(filters: AttendanceFilters) {
  return useQuery({ queryKey: laborKeys.summary(filters), queryFn: () => laborApi.summary(filters) });
}

/* ── Attendance mutations (optimistic — entry feels instant) ─────────── */

function invalidateLabour(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: laborKeys.all });
  qc.invalidateQueries({ queryKey: ["budget"] });
  qc.invalidateQueries({ queryKey: ["projects"] });
  qc.invalidateQueries({ queryKey: ["dashboard"] });
}

export function useSetQuantity(projectId: string, date: string) {
  const qc = useQueryClient();
  const key = laborKeys.sheet(projectId, date);
  return useMutation({
    mutationFn: (v: { categoryId: string; quantity: number; notes?: string | null }) =>
      laborApi.setQuantity(projectId, date, v.categoryId, v.quantity, v.notes),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<AttendanceSheet>(key);
      if (prev) {
        const rows = prev.rows.map((r) =>
          r.categoryId === v.categoryId
            ? { ...r, quantity: v.quantity, notes: v.notes !== undefined ? (v.notes ?? null) : r.notes }
            : r,
        );
        qc.setQueryData<AttendanceSheet>(key, { ...prev, rows, ...sheetTotals(rows) });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error("Couldn't save — will retry");
    },
    onSuccess: (sheet) => qc.setQueryData(key, sheet),
    onSettled: () => invalidateLabour(qc),
  });
}

export function useCopyPreviousDay(projectId: string, date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => laborApi.copyPreviousDay(projectId, date),
    onSuccess: (sheet) => {
      qc.setQueryData(laborKeys.sheet(projectId, date), sheet);
      invalidateLabour(qc);
      toast.success("Copied from the previous working day");
    },
  });
}

/* ── Category mutations ──────────────────────────────────────────────── */

export function useCategoryMutations() {
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (input: CreateCategoryInput) => laborApi.createCategory(input),
    onSuccess: (c) => {
      invalidateLabour(qc);
      toast.success("Category added", { description: c.name });
    },
    onError: (e) =>
      toast.error(e instanceof Error && e.message === "DUPLICATE_NAME" ? "That category already exists" : "Couldn't add the category"),
  });
  const update = useMutation({
    mutationFn: (v: { id: string; patch: UpdateCategoryInput }) => laborApi.updateCategory(v.id, v.patch),
    onSuccess: () => {
      invalidateLabour(qc);
      toast.success("Saved");
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => laborApi.deleteCategory(id),
    onSuccess: () => {
      invalidateLabour(qc);
      toast.success("Category deleted");
    },
  });
  return { create, update, remove };
}
