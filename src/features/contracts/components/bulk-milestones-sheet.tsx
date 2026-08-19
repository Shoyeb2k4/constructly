"use client";

/**
 * Create several milestones at once — the "6 slabs × ₹10,00,000" path.
 *
 * This is a CONVENIENCE GENERATOR, not a domain concept. Nothing about slabs,
 * prefixes or equal values exists in the model: the sheet expands what the user
 * types into ordinary milestone inputs and persists each through the same
 * canonical `createMilestonesBulk` the individual form uses. Unequal milestones
 * are entered one at a time with Add milestone.
 */

import * as React from "react";
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
import { toPaise } from "@/lib/money";
import { milestoneCoverage } from "../milestones";
import { useCreateMilestonesBulk } from "../hooks";
import type { Contract, CreateMilestoneInput } from "../types";

const MAX_COUNT = 60;

/** "Slab" × 6 → Slab 1 … Slab 6, each at the same value. */
export function buildBulkMilestones(args: {
  contractId: string;
  prefix: string;
  count: number;
  valuePaise: number;
  startNumber?: number;
}): CreateMilestoneInput[] {
  const start = args.startNumber ?? 1;
  return Array.from({ length: args.count }, (_, i) => ({
    contractId: args.contractId,
    title: `${args.prefix.trim()} ${start + i}`.trim(),
    valuePaise: args.valuePaise,
  }));
}

export function BulkMilestonesSheet({
  open,
  onOpenChange,
  contract,
  existingCount,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contract: Contract;
  /** Numbering continues from what is already there. */
  existingCount: number;
}) {
  const bulk = useCreateMilestonesBulk();
  const [prefix, setPrefix] = React.useState("Slab");
  const [count, setCount] = React.useState("6");
  const [rupees, setRupees] = React.useState("");

  const [wasOpen, setWasOpen] = React.useState(false);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setPrefix("Slab");
      setCount("6");
      setRupees("");
    }
  }

  const n = Math.min(Math.max(0, Math.floor(Number(count) || 0)), MAX_COUNT);
  const valuePaise = rupees.trim() ? toPaise(Number(rupees) || 0) : 0;
  const rows =
    n > 0 && valuePaise > 0 && prefix.trim()
      ? buildBulkMilestones({
          contractId: contract.id,
          prefix,
          count: n,
          valuePaise,
          startNumber: existingCount + 1,
        })
      : [];

  const totalPaise = rows.reduce((acc, r) => acc + r.valuePaise, 0);
  const coverage = milestoneCoverage(contract.reconciliation);
  const plannedAfter = coverage.plannedPaise + totalPaise;
  const overByPaise = Math.max(0, plannedAfter - coverage.authorisedPaise);

  const canSave = rows.length > 0 && !bulk.isPending;

  function submit() {
    if (!canSave) return;
    bulk.mutate(
      { contractId: contract.id, inputs: rows },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Create milestones in bulk</SheetTitle>
          <SheetDescription>
            {contract.title} · {contract.projectName}. Generates evenly-valued checkpoints. For
            unequal values, add them individually instead.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bulk-prefix">Name prefix</Label>
              <Input
                id="bulk-prefix"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="Slab"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bulk-count">How many</Label>
              <Input
                id="bulk-count"
                type="number"
                min={1}
                max={MAX_COUNT}
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bulk-value">Value each (₹)</Label>
              <Input
                id="bulk-value"
                type="number"
                min={0}
                value={rupees}
                onChange={(e) => setRupees(e.target.value)}
                placeholder="1000000"
              />
            </div>
          </div>

          {rows.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">
                Preview
              </p>
              <div className="overflow-hidden rounded-xl border border-border">
                {rows.map((r) => (
                  <div
                    key={r.title}
                    className="flex items-center justify-between border-b border-border px-3 py-2 text-sm last:border-0"
                  >
                    <span>{r.title}</span>
                    <MoneyText paise={r.valuePaise} className="font-mono" />
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">
                  {rows.length} milestone{rows.length === 1 ? "" : "s"}
                </span>
                <MoneyText paise={totalPaise} className="font-mono font-semibold" />
              </div>
            </div>
          ) : (
            <p className="text-sm text-foreground-subtle">
              Enter a prefix, a count and a value to preview what will be created.
            </p>
          )}

          <div className="space-y-1 rounded-lg border border-border bg-surface-muted/50 px-3 py-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-foreground-muted">Agreement value</span>
              <MoneyText paise={coverage.authorisedPaise} className="font-mono" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-foreground-muted">Planned milestone value after this</span>
              <MoneyText paise={plannedAfter} className="font-mono" />
            </div>
          </div>

          {overByPaise > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning-subtle/50 px-3 py-2 text-xs text-warning-foreground">
              This would plan <MoneyText paise={overByPaise} /> above the authorised agreement
              value. Allowed while planning, but completions are refused past{" "}
              <MoneyText paise={coverage.authorisedPaise} />.
            </div>
          )}
        </div>

        <SheetFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSave}>
            {bulk.isPending
              ? "Creating…"
              : `Create ${rows.length || ""} milestone${rows.length === 1 ? "" : "s"}`.replace(/\s+/g, " ")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
