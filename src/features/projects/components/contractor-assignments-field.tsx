"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Trash2, HardHat } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useContractors } from "@/features/contractors/hooks";
import { useCategories } from "@/features/labor/hooks";
import type { ContractorAssignmentInput } from "../types";

const key = (r: ContractorAssignmentInput) => `${r.contractorId}|${r.labourCategoryId}`;

/**
 * Add/remove contractor↔work-category rows (the client's "Pappu → Civil,
 * Shoeb → Tiles"). Controlled: the parent owns the rows. Reuses the existing
 * Contractor + LabourCategory data — no new taxonomy. Duplicate (contractor +
 * category) pairs are flagged inline; incomplete rows are ignored on submit
 * (see `cleanAssignments`).
 */
export function ContractorAssignmentsField({
  value,
  onChange,
}: {
  value: ContractorAssignmentInput[];
  onChange: (rows: ContractorAssignmentInput[]) => void;
}) {
  const { data: contractors = [] } = useContractors({ status: "ACTIVE" });
  const { data: categories = [] } = useCategories();

  const setRow = (i: number, patch: Partial<ContractorAssignmentInput>) =>
    onChange(value.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => onChange([...value, { contractorId: "", labourCategoryId: "" }]);
  const removeRow = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  // Mark a row as a duplicate only when it's complete AND an earlier complete
  // row already has the same (contractor, category).
  const isDup = (i: number) => {
    const r = value[i];
    if (!r.contractorId || !r.labourCategoryId) return false;
    return value.findIndex((o) => o.contractorId && o.labourCategoryId && key(o) === key(r)) < i;
  };

  if (contractors.length === 0) {
    return (
      <p className="text-sm text-foreground-subtle">
        No active contractors yet.{" "}
        <Link href="/labor/contractors" className="text-primary hover:underline">
          Add a contractor
        </Link>{" "}
        first, then assign them here.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <HardHat className="size-5 text-foreground-subtle" />
          <p className="text-sm text-foreground-muted">No contractors assigned yet.</p>
        </div>
      ) : (
        value.map((row, i) => {
          const dup = isDup(i);
          return (
            <div key={i} className="space-y-1">
              <div className="flex items-center gap-2">
                <Select value={row.contractorId || undefined} onValueChange={(v) => setRow(i, { contractorId: v })}>
                  <SelectTrigger className="flex-1" aria-label="Contractor">
                    <SelectValue placeholder="Contractor" />
                  </SelectTrigger>
                  <SelectContent>
                    {contractors.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={row.labourCategoryId || undefined} onValueChange={(v) => setRow(i, { labourCategoryId: v })}>
                  <SelectTrigger className="flex-1" aria-label="Work category">
                    <SelectValue placeholder="Work category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-foreground-subtle">
                        No categories — set them up in Labour.
                      </div>
                    ) : (
                      categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-foreground-subtle hover:text-danger-foreground"
                  onClick={() => removeRow(i)}
                  aria-label="Remove assignment"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              {dup && (
                <p className="pl-1 text-xs text-danger-foreground">
                  This contractor is already assigned to this category.
                </p>
              )}
            </div>
          );
        })
      )}

      <Button type="button" variant="secondary" size="sm" onClick={addRow} className="w-full">
        <Plus className="size-4" />
        Add contractor
      </Button>
    </div>
  );
}

/** Drop incomplete rows and exact duplicates before persisting. */
export function cleanAssignments(rows: ContractorAssignmentInput[]): ContractorAssignmentInput[] {
  const seen = new Set<string>();
  const out: ContractorAssignmentInput[] = [];
  for (const r of rows) {
    if (!r.contractorId || !r.labourCategoryId) continue;
    if (seen.has(key(r))) continue;
    seen.add(key(r));
    out.push({ contractorId: r.contractorId, labourCategoryId: r.labourCategoryId });
  }
  return out;
}
