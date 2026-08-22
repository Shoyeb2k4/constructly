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
import { MoneyInput } from "@/components/patterns/money-input";
import { useContractors } from "@/features/contractors/hooks";
import { useCategories } from "@/features/labor/hooks";
import type { ProjectContractorInput } from "../types";

/** Agreement-rate units (project-level ₹/sq.ft etc. — display only, not billed). */
const RATE_UNITS = [
  { value: "sqft", label: "/ sq.ft" },
  { value: "lumpsum", label: "lump sum" },
];


/**
 * Contractor-first labour config for a project (the owner's mental model):
 *
 *   Pappu
 *     Contract rate (optional): ₹240 / sq.ft
 *     Mason        ₹800/day
 *     Mason Helper ₹700/day
 *   Saddam
 *     Centering    ₹950/day
 *
 * Controlled: the parent owns the rows (ProjectContractorInput[]). Reuses the
 * existing Contractor master + LabourSubcategory taxonomy — no new taxonomy. The
 * same labour type may appear under different contractors (Pappu-Centering and
 * Saddam-Centering) with different rates. Duplicate contractors / labour types
 * are flagged inline; incomplete rows are dropped on submit (cleanAssignments).
 */
export function ContractorAssignmentsField({
  value,
  onChange,
}: {
  value: ProjectContractorInput[];
  onChange: (rows: ProjectContractorInput[]) => void;
}) {
  const { data: contractors = [] } = useContractors({ status: "ACTIVE" });
  const { data: categories = [] } = useCategories();

  // Subcategory (labour-type) global default rate, keyed by id — used to
  // pre-fill a fresh row's rate so the user isn't forced to retype the default.
  const subDefault = React.useMemo(() => {
    const m = new Map<string, number | null>();
    for (const c of categories) for (const s of c.subcategories) m.set(s.id, s.dailyRatePaise);
    return m;
  }, [categories]);

  const hasSubcategories = categories.some((c) => c.subcategories.length > 0);

  const setContractor = (i: number, patch: Partial<ProjectContractorInput>) =>
    onChange(value.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addContractor = () => onChange([...value, { contractorId: "", labourRates: [] }]);
  const removeContractor = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  const addRate = (i: number) =>
    setContractor(i, { labourRates: [...value[i].labourRates, { labourSubcategoryId: "", ratePaise: 0 }] });
  const setRate = (i: number, j: number, patch: Partial<ProjectContractorInput["labourRates"][number]>) =>
    setContractor(i, {
      labourRates: value[i].labourRates.map((lr, k) => (k === j ? { ...lr, ...patch } : lr)),
    });
  const removeRate = (i: number, j: number) =>
    setContractor(i, { labourRates: value[i].labourRates.filter((_, k) => k !== j) });

  if (contractors.length === 0) {
    return (
      <p className="text-sm text-foreground-subtle">
        No active contractors yet.{" "}
        <Link href="/labor/contractors" className="text-primary hover:underline">
          Add a contractor
        </Link>{" "}
        first, then configure them here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <HardHat className="size-5 text-foreground-subtle" />
          <p className="text-sm text-foreground-muted">No contractors on this project yet.</p>
        </div>
      ) : (
        value.map((row, i) => {
          const dupContractor =
            !!row.contractorId && value.findIndex((o) => o.contractorId === row.contractorId) < i;
          return (
            <div key={i} className="space-y-3 rounded-lg border border-border bg-surface p-3">
              <div className="flex items-center gap-2">
                <Select
                  value={row.contractorId || undefined}
                  onValueChange={(v) => setContractor(i, { contractorId: v })}
                >
                  <SelectTrigger className="flex-1 font-medium" aria-label="Contractor">
                    <SelectValue placeholder="Select contractor" />
                  </SelectTrigger>
                  <SelectContent>
                    {contractors.map((c) => {
                      const takenElsewhere =
                        c.id !== row.contractorId && value.some((o) => o.contractorId === c.id);
                      return (
                        <SelectItem key={c.id} value={c.id} disabled={takenElsewhere}>
                          {c.name}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-foreground-subtle hover:text-danger-foreground"
                  onClick={() => removeContractor(i)}
                  aria-label="Remove contractor"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              {dupContractor && (
                <p className="pl-1 text-xs text-danger-foreground">
                  This contractor is already added.
                </p>
              )}

              {/* Optional project agreement rate (₹/sq.ft) — display only. */}
              <div className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-xs text-foreground-subtle">Contract rate</span>
                <div className="flex-1">
                  <MoneyInput
                    placeholder="optional"
                    aria-label="Contract agreement rate"
                    className="h-8"
                    value={row.contractRatePaise ?? null}
                    onValueChange={(paise) => setContractor(i, { contractRatePaise: paise })}
                  />
                </div>
                <Select
                  value={row.contractRateUnit ?? "sqft"}
                  onValueChange={(v) => setContractor(i, { contractRateUnit: v })}
                >
                  <SelectTrigger className="h-8 w-28 shrink-0" aria-label="Contract rate unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RATE_UNITS.map((u) => (
                      <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Labour types the contractor supplies + per-type day rate. */}
              <div className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">
                  Labour types
                </p>
                {row.labourRates.map((lr, j) => {
                  const dupSub =
                    !!lr.labourSubcategoryId &&
                    row.labourRates.findIndex((o) => o.labourSubcategoryId === lr.labourSubcategoryId) < j;
                  return (
                    <div key={j} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Select
                          value={lr.labourSubcategoryId || undefined}
                          onValueChange={(v) =>
                            setRate(i, j, {
                              labourSubcategoryId: v,
                              // Pre-fill a fresh row with the type's global default rate.
                              ...(lr.ratePaise === 0 && subDefault.get(v) ? { ratePaise: subDefault.get(v)! } : {}),
                            })
                          }
                        >
                          <SelectTrigger className="flex-1" aria-label="Labour type">
                            <SelectValue placeholder="Labour type" />
                          </SelectTrigger>
                          <SelectContent>
                            {!hasSubcategories ? (
                              <div className="px-2 py-1.5 text-xs text-foreground-subtle">
                                No labour types — set them up in Labour.
                              </div>
                            ) : (
                              categories.flatMap((c) =>
                                c.subcategories.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    {c.name} · {s.name}
                                  </SelectItem>
                                )),
                              )
                            )}
                          </SelectContent>
                        </Select>
                        <div className="w-36 shrink-0">
                          <MoneyInput
                            placeholder="rate"
                            aria-label="Day rate"
                            className="h-8"
                            value={lr.ratePaise || null}
                            onValueChange={(paise) => setRate(i, j, { ratePaise: paise ?? 0 })}
                          />
                          <span className="text-[10px] text-foreground-subtle">/day</span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0 text-foreground-subtle hover:text-danger-foreground"
                          onClick={() => removeRate(i, j)}
                          aria-label="Remove labour type"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      {dupSub && (
                        <p className="pl-1 text-xs text-danger-foreground">
                          Already added for this contractor.
                        </p>
                      )}
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => addRate(i)}
                  className="text-primary"
                >
                  <Plus className="size-4" />
                  Add labour type
                </Button>
              </div>
            </div>
          );
        })
      )}

      <Button type="button" variant="secondary" size="sm" onClick={addContractor} className="w-full">
        <Plus className="size-4" />
        Add contractor
      </Button>
    </div>
  );
}

/** Drop incomplete contractors/labour types and dedupe before persisting. */
export function cleanAssignments(rows: ProjectContractorInput[]): ProjectContractorInput[] {
  const seenContractor = new Set<string>();
  const out: ProjectContractorInput[] = [];
  for (const r of rows) {
    if (!r.contractorId || seenContractor.has(r.contractorId)) continue;
    seenContractor.add(r.contractorId);
    const seenSub = new Set<string>();
    const labourRates = [];
    for (const lr of r.labourRates) {
      if (!lr.labourSubcategoryId || seenSub.has(lr.labourSubcategoryId)) continue;
      seenSub.add(lr.labourSubcategoryId);
      labourRates.push({
        labourSubcategoryId: lr.labourSubcategoryId,
        ratePaise: Math.max(0, Math.round(lr.ratePaise || 0)),
        rateUnit: lr.rateUnit ?? "day",
      });
    }
    out.push({
      contractorId: r.contractorId,
      contractRatePaise: r.contractRatePaise ?? null,
      contractRateUnit: r.contractRateUnit ?? null,
      labourRates,
    });
  }
  return out;
}
