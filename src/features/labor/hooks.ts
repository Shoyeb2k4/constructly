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
  ForceDeleteKind,
  SetQuantityInput,
  UpdateCategoryInput,
  UpdateSubcategoryInput,
} from "./types";

/* ── Queries ─────────────────────────────────────────────────────────── */

export function useCategories() {
  return useQuery({ queryKey: laborKeys.categories, queryFn: () => laborApi.listCategories() });
}

/** Impact preview for an Owner Force Delete. Fetches only when a target is set
 *  (i.e. the confirmation dialog is open). */
export function useForceDeletePreview(target: { kind: ForceDeleteKind; id: string } | null) {
  return useQuery({
    queryKey: ["labor", "force-delete-preview", target?.kind, target?.id],
    queryFn: () => laborApi.forceDeletePreview(target!.kind, target!.id),
    enabled: !!target,
    staleTime: 0,
  });
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
    mutationFn: (v: Omit<SetQuantityInput, "projectId" | "date">) =>
      laborApi.setQuantity({ ...v, projectId, date }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<AttendanceSheet>(key);
      if (prev) {
        const cid = v.contractorId ?? null;
        const agreementId = v.contractId ?? null;
        // Match the ROW on its FULL identity — the same labour type can appear
        // under several contractors, and under several agreements for one
        // contractor. Matching on the subcategory alone would move the wrong
        // number in front of the user.
        const matches = (r: { subcategoryId: string; contractId: string | null }) =>
          r.subcategoryId === v.subcategoryId && r.contractId === agreementId;
        const groups = prev.groups.map((g) => {
          if (g.contractorId !== cid || !g.rows.some(matches)) return g;
          const rows = g.rows.map((r) =>
            matches(r)
              ? { ...r, quantity: v.quantity, notes: v.notes !== undefined ? (v.notes ?? null) : r.notes }
              : r,
          );
          return { ...g, rows, ...rowTotals(rows) };
        });
        qc.setQueryData<AttendanceSheet>(key, { ...prev, groups, ...sheetTotals(groups) });
      }
      return { prev };
    },
    onError: (e: unknown, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      // A settled row is refused permanently, not transiently — telling the user
      // it "will retry" would promise a save that can never happen.
      if (e instanceof Error && e.message.includes("ATTENDANCE_SETTLED")) {
        toast.error("This day has been settled — reverse the settlement to correct it");
        return;
      }
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
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "";
      toast.error(
        msg === "CATEGORY_HAS_ATTENDANCE"
          ? "This category has recorded attendance and can't be deleted"
          : msg === "CATEGORY_HAS_ASSIGNMENTS"
            ? "This category is assigned to contractors on a project — remove those assignments first"
            : "Couldn't delete the category",
      );
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
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "";
      toast.error(
        msg === "SUBCATEGORY_HAS_ATTENDANCE"
          ? "This labour type has recorded attendance and can't be deleted"
          : msg === "SUBCATEGORY_HAS_ASSIGNMENTS"
            ? "This labour type is configured under a contractor on a project — remove it there first"
            : "Couldn't delete the labour type",
      );
    },
  });
  const reorderSubcategories = useMutation({
    mutationFn: (v: { categoryId: string; orderedIds: string[] }) =>
      laborApi.reorderSubcategories(v.categoryId, v.orderedIds),
    onSettled: () => qc.invalidateQueries({ queryKey: laborKeys.all }),
  });

  // Owner Force Delete — deactivates a referenced group/type, preserving history.
  const forceDeleteFailToast = (e: unknown) => {
    const msg = e instanceof Error ? e.message : "";
    toast.error(
      msg === "FORBIDDEN"
        ? "Only the Owner can force delete"
        : msg === "CONFIRMATION_REQUIRED"
          ? "Type DELETE to confirm"
          : "Couldn't delete — please try again",
    );
  };
  const forceDeleteCategory = useMutation({
    mutationFn: (v: { id: string; ack: string; name: string }) =>
      laborApi.forceDeleteCategory(v.id, v.ack),
    onSuccess: (_r, v) => {
      invalidateLabour(qc);
      toast.success(`"${v.name}" deleted`);
    },
    onError: forceDeleteFailToast,
  });
  const forceDeleteSubcategory = useMutation({
    mutationFn: (v: { id: string; ack: string; name: string }) =>
      laborApi.forceDeleteSubcategory(v.id, v.ack),
    onSuccess: (_r, v) => {
      invalidateLabour(qc);
      toast.success(`"${v.name}" deleted`);
    },
    onError: forceDeleteFailToast,
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
    forceDeleteCategory,
    forceDeleteSubcategory,
  };
}
