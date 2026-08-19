"use client";

/**
 * Choose which labour types an agreement covers, and what this contractor is
 * paid for each under it.
 *
 * The list is the COMPANY-WIDE labour taxonomy — the same Mason every other
 * contractor uses. Ticking one here creates a pricing relationship between this
 * agreement and that shared type; it never clones the type into a
 * contractor-specific copy. That is the whole reason contractor-named labour
 * groups are the wrong answer: one type, many agreements, each with its own
 * agreed rate.
 *
 * A type that doesn't exist yet can be created right here, and it lands in that
 * same shared taxonomy — reusable by every other contractor tomorrow.
 */

import * as React from "react";
import Link from "next/link";
import { Loader2, Plus, Settings2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyText } from "@/components/patterns/money-text";
import { toPaise, toRupees } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useCategories } from "@/features/labor/hooks";
import { useCan } from "@/features/rbac/permission-context";
import { useAddScopeItem, useRemoveScopeItem, useScopeItems } from "../hooks";
import { ReviseRateSheet } from "./revise-rate-sheet";
import type { Contract, ScopeItem } from "../types";
import { NewLabourTypeForm } from "./new-labour-type-form";

/** Today in the browser's timezone, as YYYY-MM-DD. */
const todayISO = () => new Date().toLocaleDateString("en-CA");

/** A user's override of one row. Absent = whatever the agreement already says. */
type Draft = { selected: boolean; rate: string };

export function ManageScopeSheet({
  open,
  onOpenChange,
  contract,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contract: Contract;
}) {
  const can = useCan();
  const canCreateType = can("labour.create");
  const { data: categories = [], isLoading: loadingTypes } = useCategories();
  const { data: scopeItems = [], isLoading: loadingScope } = useScopeItems(contract.id);
  const addItem = useAddScopeItem();
  const removeItem = useRemoveScopeItem();

  // OVERRIDES only. Deriving each row from saved scope + this map (rather than
  // seeding a full snapshot) means a labour type created while the sheet is open
  // simply appears, already ticked, with no re-seed to fight.
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({});
  const [creating, setCreating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const inScope = React.useMemo(
    () => new Map(scopeItems.map((s) => [s.labourSubcategoryId, s])),
    [scopeItems],
  );

  // Fresh sheet, fresh overrides.
  const [wasOpen, setWasOpen] = React.useState(false);
  /** The scope item whose rate is being revised, via the one shared sheet. */
  const [revising, setRevising] = React.useState<ScopeItem | null>(null);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setDrafts({});
      setCreating(false);
    }
  }

  const resolve = React.useCallback(
    (subId: string, companyDefaultPaise: number | null): Draft => {
      const override = drafts[subId];
      if (override) return override;
      const existing = inScope.get(subId);
      return {
        selected: !!existing,
        // An unticked row suggests the company default rather than demanding a
        // number; a ticked one shows what this agreement currently pays.
        rate: String(toRupees(existing ? existing.currentRatePaise : (companyDefaultPaise ?? 0)) || ""),
      };
    },
    [drafts, inScope],
  );

  const setDraft = (subId: string, patch: Partial<Draft>, current: Draft) =>
    setDrafts((d) => ({ ...d, [subId]: { ...current, ...patch } }));

  // A rate revision may never predate the agreement, so the opening rate takes
  // effect from the agreement's own start date when it has one.
  const effectiveFrom = contract.startDate ?? todayISO();

  // NOTE what is absent: repricing. This sheet used to detect a changed rate on
  // an item already in scope and quietly call setScopeRate with
  // `effectiveFrom: today` and the canned reason "Rate updated from scope".
  // That was a second, hidden way to change a commercial term — undated,
  // unexplained, and impossible to distinguish in the audit trail from the
  // opening rate. Repricing now lives in ONE place, the Revise Rate sheet on the
  // Rates tab, which is reachable from here via the row's own link.
  //
  // Scope & Labour answers "which labour types does this contractor supply?".
  // Rates answers "what are they paid for them?".
  const changes = React.useMemo(() => {
    const toAdd: { subId: string; ratePaise: number }[] = [];
    const toRemove: ScopeItem[] = [];
    for (const cat of categories) {
      for (const sub of cat.subcategories) {
        const override = drafts[sub.id];
        if (!override) continue; // untouched rows can't be changes
        const existing = inScope.get(sub.id);
        const ratePaise = override.rate.trim() ? toPaise(Number(override.rate) || 0) : 0;
        if (override.selected && !existing) toAdd.push({ subId: sub.id, ratePaise });
        else if (!override.selected && existing) toRemove.push(existing);
      }
    }
    return { toAdd, toRemove };
  }, [categories, drafts, inScope]);

  const missingRate = changes.toAdd.some((a) => a.ratePaise <= 0);
  const dirty = changes.toAdd.length > 0 || changes.toRemove.length > 0;
  const canSave = dirty && !missingRate && !saving;

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    try {
      // Sequential, not parallel: each call is a separate audited write, and a
      // failure part-way (a type already settled, say) must leave the earlier
      // ones applied rather than half-rolled-back.
      for (const a of changes.toAdd) {
        await addItem.mutateAsync({
          contractId: contract.id,
          labourSubcategoryId: a.subId,
          ratePaise: a.ratePaise,
          effectiveFrom,
        });
      }
      for (const r of changes.toRemove) {
        // Refused when attendance already used it — the toast explains, and the
        // item simply stays in scope.
        await removeItem.mutateAsync(r.id).catch(() => {});
      }
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  const loading = loadingTypes || loadingScope;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Labour types in scope</SheetTitle>
          <SheetDescription>
            {contract.title} · {contract.projectName}. Tick the labour types this contractor
            supplies under this agreement and set what they&rsquo;re paid for each. These are your
            company&rsquo;s shared labour types — the rate is what makes them this
            agreement&rsquo;s.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {loading ? (
            <p className="py-6 text-center text-sm text-foreground-subtle">Loading labour types…</p>
          ) : (
            categories.map((cat) => (
              <div key={cat.id} className="space-y-1.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">
                  {cat.name}
                </p>
                <div className="overflow-hidden rounded-xl border border-border">
                  {cat.subcategories.map((sub) => {
                    const d = resolve(sub.id, sub.dailyRatePaise);
                    const existing = inScope.get(sub.id);
                    return (
                      <div
                        key={sub.id}
                        className={cn(
                          "flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-0",
                          d.selected && "bg-surface-muted/40",
                        )}
                      >
                        <input
                          type="checkbox"
                          id={`scope-${sub.id}`}
                          checked={d.selected}
                          onChange={() => setDraft(sub.id, { selected: !d.selected }, d)}
                          className="size-4 shrink-0 accent-primary"
                        />
                        <Label
                          htmlFor={`scope-${sub.id}`}
                          className="min-w-0 flex-1 cursor-pointer truncate text-sm font-normal"
                        >
                          {sub.name}
                          {sub.dailyRatePaise != null && (
                            <span className="ml-1.5 text-xs text-foreground-subtle">
                              company default <MoneyText paise={sub.dailyRatePaise} whole />
                            </span>
                          )}
                        </Label>
                        {existing ? (
                          // Already priced: the rate is history, not a form field.
                          // Changing it is a dated, reasoned revision — one door.
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="font-mono text-sm text-foreground-muted">
                              <MoneyText paise={existing.currentRatePaise} whole />
                              <span className="ml-0.5 text-xs text-foreground-subtle">
                                /{existing.rateUnit}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => setRevising(existing)}
                              className="text-xs text-primary transition-colors hover:underline"
                            >
                              Revise
                            </button>
                          </div>
                        ) : (
                          <div className="flex shrink-0 items-center gap-1">
                            <span className="text-xs text-foreground-subtle">₹</span>
                            <Input
                              type="number"
                              min={0}
                              value={d.rate}
                              onChange={(e) =>
                                setDraft(sub.id, { selected: true, rate: e.target.value }, d)
                              }
                              placeholder="rate"
                              aria-label={`${sub.name} agreement rate per day`}
                              className="h-8 w-24 text-sm"
                            />
                            <span className="text-xs text-foreground-subtle">/day</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {cat.subcategories.length === 0 && (
                    <p className="px-3 py-2.5 text-sm text-foreground-subtle">
                      No labour types in this trade yet.
                    </p>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Create the type where it's needed. It still lands in the shared
              taxonomy — Ramesh can price the same one tomorrow. */}
          {!loading && canCreateType && !creating && (
            <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
              <Plus />
              Create labour type
            </Button>
          )}
          {!loading && canCreateType && creating && (
            <NewLabourTypeForm
              categories={categories}
              onCancel={() => setCreating(false)}
              onCreated={(sub) => {
                setCreating(false);
                // Tick it immediately, priced at the company default until the
                // user overrides it for this agreement.
                setDrafts((d) => ({
                  ...d,
                  [sub.id]: {
                    selected: true,
                    rate: String(toRupees(sub.dailyRatePaise ?? 0) || ""),
                  },
                }));
              }}
            />
          )}
          {!loading && !canCreateType && (
            <p className="text-xs text-foreground-subtle">
              You can price any existing labour type here. Creating new ones needs the labour
              create permission.
            </p>
          )}

          {missingRate && (
            <p className="text-xs text-danger-foreground">
              Every labour type you add needs a rate — it is what the agreement pays for that work.
            </p>
          )}
          {changes.toAdd.length > 0 && (
            <p className="text-xs text-foreground-subtle">
              New rates take effect from {effectiveFrom}, so attendance recorded from the
              agreement&rsquo;s start resolves against them.
            </p>
          )}

          <Link
            href="/labor/categories"
            className="inline-flex items-center gap-1.5 text-xs text-foreground-subtle transition-colors hover:text-foreground"
          >
            <Settings2 className="size-3.5" />
            Manage labour taxonomy
          </Link>
        </div>

        <SheetFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSave}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? "Saving…" : "Save scope"}
          </Button>
        </SheetFooter>
      </SheetContent>

      {/* The SAME sheet the Rates tab opens — dated, reasoned, append-only.
          There is no second way to change a rate. */}
      {revising && (
        <ReviseRateSheet
          item={revising}
          contract={contract}
          open
          onOpenChange={(o) => !o && setRevising(null)}
        />
      )}
    </Sheet>
  );
}
