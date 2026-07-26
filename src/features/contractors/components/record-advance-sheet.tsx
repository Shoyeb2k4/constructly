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
import { toPaise } from "@/lib/money";
import { useRecordAdvance } from "../hooks";

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function RecordAdvanceSheet({
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
  const record = useRecordAdvance();
  const [date, setDate] = React.useState(todayISO());
  const [rupees, setRupees] = React.useState("");
  const [notes, setNotes] = React.useState("");

  const [key, setKey] = React.useState(false);
  if (key !== open) {
    setKey(open);
    if (open) {
      setDate(todayISO());
      setRupees("");
      setNotes("");
    }
  }

  const amountPaise = rupees.trim() ? toPaise(Number(rupees) || 0) : 0;
  const canSave = amountPaise > 0 && !record.isPending;

  function submit() {
    if (!canSave) return;
    record.mutate(
      { contractorId, date, amountPaise, notes: notes.trim() || null },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Record advance</SheetTitle>
          <SheetDescription>An advance paid to {contractorName}.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Amount (₹)</Label>
            <Input
              type="number"
              min={0}
              value={rupees}
              onChange={(e) => setRupees(e.target.value)}
              placeholder="e.g. 100000"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <SheetFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!canSave}>Record advance</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
