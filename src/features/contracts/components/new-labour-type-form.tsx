"use client";

/**
 * Create a labour type without leaving whatever you were doing.
 *
 * Whatever the surrounding context — an agreement's scope, a day's attendance
 * sheet — the type lands in the COMPANY-WIDE taxonomy. It is shared master
 * data: the Tile Mason Pappu needed today is the same one Ramesh prices
 * differently next month. Creating it from here never makes a
 * contractor-specific record, which is exactly the duplication that
 * contractor-named labour groups used to cause.
 *
 * A trade can be created inline too, for the case where the whole group is new.
 */

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoneyInput } from "@/components/patterns/money-input";
import { useHierarchyMutations } from "@/features/labor/hooks";
import type { CategoryWithSubs, LabourSubcategory } from "@/features/labor/types";

/** Sentinel for "create a new trade" in the trade picker. */
const NEW_TRADE = "__new__";

export function NewLabourTypeForm({
  categories,
  onCreated,
  onCancel,
}: {
  categories: CategoryWithSubs[];
  /** The created type, already in the shared taxonomy. */
  onCreated: (sub: LabourSubcategory) => void;
  onCancel: () => void;
}) {
  const { createCategory, createSubcategory } = useHierarchyMutations();

  const [categoryId, setCategoryId] = React.useState(categories[0]?.id ?? NEW_TRADE);
  const [newTrade, setNewTrade] = React.useState("");
  const [name, setName] = React.useState("");
  const [ratePaise, setRatePaise] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);

  const makingTrade = categoryId === NEW_TRADE;
  const canSave = !!name.trim() && (!makingTrade || !!newTrade.trim()) && !busy;

  async function submit() {
    if (!canSave) return;
    setBusy(true);
    try {
      const targetId = makingTrade
        ? (await createCategory.mutateAsync({ name: newTrade.trim() })).id
        : categoryId;
      const sub = await createSubcategory.mutateAsync({
        categoryId: targetId,
        name: name.trim(),
        // The COMPANY default — a starting point for everyone. An agreement's
        // own rate is set separately and never overwrites this.
        dailyRatePaise: ratePaise,
      });
      onCreated(sub);
      setName("");
      setRatePaise(null);
      setNewTrade("");
    } catch {
      // The mutation's own toast already explained it (duplicate name, etc.).
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface-muted/40 p-3">
      <p className="text-xs text-foreground-subtle">
        New labour types join your company&rsquo;s shared list — every contractor can be priced
        against them.
      </p>

      <div className="space-y-1.5">
        <Label>Trade</Label>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select trade" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
            <SelectItem value={NEW_TRADE}>+ New trade…</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {makingTrade && (
        <div className="space-y-1.5">
          <Label htmlFor="new-trade-name">New trade name</Label>
          <Input
            id="new-trade-name"
            value={newTrade}
            onChange={(e) => setNewTrade(e.target.value)}
            placeholder="e.g. Masonry"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="new-type-name">Labour type</Label>
          <Input
            id="new-type-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Tile Mason"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-type-rate">Company default</Label>
          <MoneyInput
            id="new-type-rate"
            value={ratePaise}
            onValueChange={setRatePaise}
            placeholder="900"
            suffix="/ day"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="secondary" size="sm" onClick={submit} disabled={!canSave}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          Create labour type
        </Button>
      </div>
    </div>
  );
}
