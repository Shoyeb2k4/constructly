"use client";

/**
 * Create or edit ONE milestone — an earned-value checkpoint on an agreement.
 *
 * What this form is not: a payment. Nothing here moves money or attaches an
 * existing payment to the checkpoint. The value entered is what the agreement
 * will have EARNED once this milestone is marked complete.
 *
 * Money is handled in integer paise throughout; the rupee input is converted once
 * on submit via the shared `toPaise`, never accumulated as a float.
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
import { Textarea } from "@/components/ui/textarea";
import { MoneyText } from "@/components/patterns/money-text";
import { toPaise, toRupees } from "@/lib/money";
import { milestoneCoverage } from "../milestones";
import { useCreateMilestone, useUpdateMilestone } from "../hooks";
import type { Contract, Milestone } from "../types";

export function MilestoneFormSheet({
  open,
  onOpenChange,
  contract,
  milestone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contract: Contract;
  /** Present = edit mode. */
  milestone?: Milestone;
}) {
  const isEdit = !!milestone;
  const create = useCreateMilestone();
  const update = useUpdateMilestone();

  const [title, setTitle] = React.useState("");
  const [rupees, setRupees] = React.useState("");
  const [plannedDate, setPlannedDate] = React.useState("");
  const [notes, setNotes] = React.useState("");

  const [wasOpen, setWasOpen] = React.useState(false);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setTitle(milestone?.title ?? "");
      setRupees(milestone ? String(toRupees(milestone.valuePaise)) : "");
      setPlannedDate(milestone?.plannedDate ?? "");
      setNotes(milestone?.notes ?? "");
    }
  }

  const valuePaise = rupees.trim() ? toPaise(Number(rupees) || 0) : 0;
  const pending = create.isPending || update.isPending;
  const canSave = !!title.trim() && valuePaise > 0 && !pending;

  // Planned coverage AFTER this change, from the engine's own figures — so the
  // warning the user sees here is the same one the tab shows afterwards.
  const coverage = milestoneCoverage(contract.reconciliation);
  const deltaPaise = valuePaise - (milestone?.valuePaise ?? 0);
  const plannedAfter = coverage.plannedPaise + deltaPaise;
  const overByPaise = Math.max(0, plannedAfter - coverage.authorisedPaise);

  // The value of an ALREADY-completed milestone is recognised earned value, so
  // the server holds it to the same ceiling as completing one. Say so up front.
  const completed = milestone?.status === "COMPLETED";

  function submit() {
    if (!canSave) return;
    if (isEdit) {
      update.mutate(
        {
          id: milestone!.id,
          patch: {
            title: title.trim(),
            valuePaise,
            plannedDate: plannedDate || null,
            notes: notes.trim() || null,
          },
        },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      create.mutate(
        {
          contractId: contract.id,
          title: title.trim(),
          valuePaise,
          plannedDate: plannedDate || null,
          notes: notes.trim() || null,
        },
        { onSuccess: () => onOpenChange(false) },
      );
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit milestone" : "Add milestone"}</SheetTitle>
          <SheetDescription>
            {contract.title} · {contract.projectName}. A milestone records how much of the
            agreement has been earned when it completes — it is not a payment bucket.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="space-y-1.5">
            <Label htmlFor="milestone-title">Milestone name</Label>
            <Input
              id="milestone-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Slab 1"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="milestone-value">Value (₹)</Label>
              <Input
                id="milestone-value"
                type="number"
                min={0}
                value={rupees}
                onChange={(e) => setRupees(e.target.value)}
                placeholder="e.g. 1000000"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="milestone-date">Target date (optional)</Label>
              <Input
                id="milestone-date"
                type="date"
                value={plannedDate}
                onChange={(e) => setPlannedDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="milestone-notes">Notes (optional)</Label>
            <Textarea
              id="milestone-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1 rounded-lg border border-border bg-surface-muted/50 px-3 py-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-foreground-muted">Agreement value</span>
              <MoneyText paise={coverage.authorisedPaise} className="font-mono" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-foreground-muted">
                Planned milestone value {isEdit ? "after this edit" : "with this one"}
              </span>
              <MoneyText paise={plannedAfter} className="font-mono" />
            </div>
          </div>

          {overByPaise > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning-subtle/50 px-3 py-2 text-xs text-warning-foreground">
              Planned milestones would total <MoneyText paise={overByPaise} /> above the authorised
              agreement value. That is allowed while you plan, but completing milestones past{" "}
              <MoneyText paise={coverage.authorisedPaise} /> is refused — raise an amendment to
              increase the agreement first.
            </div>
          )}

          {completed && (
            <p className="text-xs text-foreground-subtle">
              This milestone is already completed, so its value is recognised earned work. Changing
              it is held to the same authorised-value ceiling as completing one.
            </p>
          )}
        </div>

        <SheetFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSave}>
            {pending ? "Saving…" : isEdit ? "Save changes" : "Add milestone"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
