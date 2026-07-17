"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { laborApi, laborKeys } from "./data";
import { rowTotals, sheetTotals } from "./calc";
import type {
  AttendanceFilters,
  AttendanceSheet,
  CreateCategoryInput,
  CreateSubcategoryInput,
  UpdateCategoryInput,
  UpdateSubcategoryInput,
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
    mutationFn: (v: { subcategoryId: string; quantity: number; notes?: string | null }) =>
      laborApi.setQuantity(projectId, date, v.subcategoryId, v.quantity, v.notes),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<AttendanceSheet>(key);
      if (prev) {
        const groups = prev.groups.map((g) => {
          if (!g.rows.some((r) => r.subcategoryId === v.subcategoryId)) return g;
          const rows = g.rows.map((r) =>
            r.subcategoryId === v.subcategoryId
              ? { ...r, quantity: v.quantity, notes: v.notes !== undefined ? (v.notes ?? null) : r.notes }
              : r,
          );
          return { ...g, rows, ...rowTotals(rows) };
        });
        qc.setQueryData<AttendanceSheet>(key, { ...prev, groups, ...sheetTotals(groups) });
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

/* ── Hierarchy mutations ─────────────────────────────────────────────── */

export function useHierarchyMutations() {
  const qc = useQueryClient();
  const dupeToast = (e: unknown, fallback: string) =>
    toast.error(e instanceof Error && e.message === "DUPLICATE_NAME" ? "That name already exists" : fallback);

  const createCategory = useMutation({
    mutationFn: (input: CreateCategoryInput) => laborApi.createCategory(input),
    onSuccess: (c) => {
      invalidateLabour(qc);
      toast.success("Category added", { description: c.name });
    },
    onError: (e) => dupeToast(e, "Couldn't add the category"),
  });
  const updateCategory = useMutation({
    mutationFn: (v: { id: string; patch: UpdateCategoryInput }) => laborApi.updateCategory(v.id, v.patch),
    onSuccess: () => {
      invalidateLabour(qc);
      toast.success("Saved");
    },
  });
  const deleteCategory = useMutation({
    mutationFn: (id: string) => laborApi.deleteCategory(id),
    onSuccess: () => {
      invalidateLabour(qc);
      toast.success("Category deleted");
    },
  });
  const reorderCategories = useMutation({
    mutationFn: (orderedIds: string[]) => laborApi.reorderCategories(orderedIds),
    onSettled: () => qc.invalidateQueries({ queryKey: laborKeys.all }),
  });

  const createSubcategory = useMutation({
    mutationFn: (input: CreateSubcategoryInput) => laborApi.createSubcategory(input),
    onSuccess: (s) => {
      invalidateLabour(qc);
      toast.success("Subcategory added", { description: s.name });
    },
    onError: (e) => dupeToast(e, "Couldn't add the subcategory"),
  });
  const updateSubcategory = useMutation({
    mutationFn: (v: { id: string; patch: UpdateSubcategoryInput }) => laborApi.updateSubcategory(v.id, v.patch),
    onSuccess: () => {
      invalidateLabour(qc);
      toast.success("Saved");
    },
  });
  const deleteSubcategory = useMutation({
    mutationFn: (id: string) => laborApi.deleteSubcategory(id),
    onSuccess: () => {
      invalidateLabour(qc);
      toast.success("Subcategory deleted");
    },
  });
  const reorderSubcategories = useMutation({
    mutationFn: (v: { categoryId: string; orderedIds: string[] }) =>
      laborApi.reorderSubcategories(v.categoryId, v.orderedIds),
    onSettled: () => qc.invalidateQueries({ queryKey: laborKeys.all }),
  });

  return {
    createCategory,
    updateCategory,
    deleteCategory,
    reorderCategories,
    createSubcategory,
    updateSubcategory,
    deleteSubcategory,
    reorderSubcategories,
  };
}
