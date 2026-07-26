"use client";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoneyText } from "@/components/patterns/money-text";
import { toPaise } from "@/lib/money";
import { useProjects } from "@/features/projects/hooks";
import { usePreviewSettlement, useCreateSettlement } from "../hooks";
import type { SettlementPreview } from "../types";

function isoDaysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function Row({ label, paise, strong }: { label: string; paise: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className={strong ? "font-medium" : "text-foreground-muted"}>{label}</span>
      <span className={strong ? "font-mono font-semibold" : "font-mono"}>
        <MoneyText paise={paise} />
      </span>
    </div>
  );
}

export function SettlementSheet({
  open,
  onOpenChange,
  contractorId,
  contractorName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contractorId: string;
  contractorName: string;
}) {
  const { data: projects = [] } = useProjects({});
  const preview = usePreviewSettlement();
  const create = useCreateSettlement();

  const [projectId, setProjectId] = React.useState("");
  const [periodStart, setPeriodStart] = React.useState(isoDaysAgo(6));
  const [periodEnd, setPeriodEnd] = React.useState(isoDaysAgo(0));
  const [adjRupees, setAdjRupees] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [result, setResult] = React.useState<SettlementPreview | null>(null);

  // Reset when reopened.
  const [wasOpen, setWasOpen] = React.useState(false);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setProjectId("");
      setPeriodStart(isoDaysAgo(6));
      setPeriodEnd(isoDaysAgo(0));
      setAdjRupees("");
      setNotes("");
      setResult(null);
    }
  }

  const adjPaise = adjRupees.trim() ? toPaise(Number(adjRupees) || 0) : 0;
  const inputsValid = !!projectId && !!periodStart && !!periodEnd && periodStart <= periodEnd;

  // Live preview: recompute whenever the inputs change.
  React.useEffect(() => {
    if (!inputsValid) return;
    let cancelled = false;
    preview
      .mutateAsync({ contractorId, projectId, periodStart, periodEnd, advanceAdjustmentPaise: adjPaise })
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // preview is a stable mutation trigger; re-run only on input changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputsValid, contractorId, projectId, periodStart, periodEnd, adjPaise]);

  const shown = inputsValid ? result : null;
  const canSave = inputsValid && !!shown && !create.isPending;

  function submit() {
    if (!canSave || !shown) return;
    create.mutate(
      {
        contractorId,
        projectId,
        periodStart,
        periodEnd,
        advanceAdjustmentPaise: shown.advanceAdjustmentPaise, // already clamped by the preview
        notes: notes.trim() || null,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>New settlement</SheetTitle>
          <SheetDescription>Weekly settlement for {contractorName}.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="space-y-1.5">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select project" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Period start</Label>
              <Input type="date" value={periodStart} max={periodEnd} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Period end</Label>
              <Input type="date" value={periodEnd} min={periodStart} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
          </div>

          {/* Computed summary */}
          <div className="rounded-xl border border-border bg-surface-muted/40 px-4 py-3">
            {!inputsValid ? (
              <p className="py-2 text-sm text-foreground-subtle">
                Pick a project and period to compute the labour bill.
              </p>
            ) : !shown ? (
              <p className="py-2 text-sm text-foreground-subtle">Calculating…</p>
            ) : (
              <>
                <Row label="Weekly labour bill" paise={shown.labourBillPaise} />
                <Row label="Outstanding advance" paise={shown.outstandingAdvancePaise} />
                <div className="my-2 space-y-1.5 border-y border-border py-2">
                  <Label>Advance adjustment (₹)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={adjRupees}
                    onChange={(e) => setAdjRupees(e.target.value)}
                    placeholder="0"
                  />
                  <p className="text-xs text-foreground-subtle">
                    Max adjustable: <MoneyText paise={shown.maxAdjustmentPaise} /> (applied:{" "}
                    <MoneyText paise={shown.advanceAdjustmentPaise} />)
                  </p>
                </div>
                <Row label="Net payment" paise={shown.netPaymentPaise} strong />
                <Row label="Remaining advance" paise={shown.advanceBalanceAfterPaise} />
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <SheetFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!canSave}>Record settlement</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
