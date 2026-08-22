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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoneyText } from "@/components/patterns/money-text";
import { MoneyInput } from "@/components/patterns/money-input";
import { useRecordContractPayment } from "../hooks";
import { PAYMENT_MODES, PAYMENT_MODE_LABEL, PAYMENT_TYPES, PAYMENT_TYPE_LABEL } from "../constants";
import type { Contract, ContractPaymentType, PaymentMode } from "../types";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function RecordContractPaymentSheet({
  open,
  onOpenChange,
  contract,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contract: Contract;
}) {
  const record = useRecordContractPayment();
  const [date, setDate] = React.useState(todayISO());
  const [amountPaiseRaw, setAmountPaise] = React.useState<number | null>(null);
  const [type, setType] = React.useState<ContractPaymentType>("INTERIM");
  const [mode, setMode] = React.useState<PaymentMode>("BANK_TRANSFER");
  const [reference, setReference] = React.useState("");
  const [notes, setNotes] = React.useState("");

  const [wasOpen, setWasOpen] = React.useState(false);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setDate(todayISO());
      setAmountPaise(null);
      setType("INTERIM");
      setMode("BANK_TRANSFER");
      setReference("");
      setNotes("");
    }
  }

  const amountPaise = amountPaiseRaw ?? 0;
  // The credit ceiling: total credits may never exceed the agreement's
  // AUTHORISED value. Paying ahead of earned work is fine — only this binds, and
  // raising it requires an approved amendment. Advisory here; the server
  // re-checks against committed state.
  const headroomPaise = Math.max(
    0,
    contract.reconciliation.currentContractValuePaise - contract.reconciliation.totalCreditedPaise,
  );
  const overpay = amountPaise > headroomPaise;
  const canSave = amountPaise > 0 && !overpay && !record.isPending;

  function submit() {
    if (!canSave) return;
    // Idempotency key minted at submit time (event handler, not render); the
    // button is disabled while pending, so a click can't double-record.
    const clientUuid =
      typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : undefined;
    record.mutate(
      {
        contractId: contract.id,
        amountPaise,
        type,
        paymentMode: mode,
        date,
        referenceNumber: reference.trim() || null,
        notes: notes.trim() || null,
        clientUuid,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Add payment</SheetTitle>
          <SheetDescription>{contract.title} · {contract.projectName}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="space-y-1 rounded-lg border border-border bg-surface-muted/50 px-3 py-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-foreground-muted">Currently due</span>
              <MoneyText paise={contract.reconciliation.currentDuePaise} className="font-semibold" />
            </div>
            <div className="flex items-center justify-between text-xs text-foreground-subtle">
              <span>Can still be credited</span>
              <MoneyText paise={headroomPaise} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Amount</Label>
              <MoneyInput
                value={amountPaiseRaw}
                onValueChange={setAmountPaise}
                placeholder="50,000"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as ContractPaymentType)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{PAYMENT_TYPE_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as PaymentMode)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_MODES.map((m) => (
                    <SelectItem key={m} value={m}>{PAYMENT_MODE_LABEL[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Reference # (optional)</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque / UPI ref" />
          </div>
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          {overpay && (
            <div className="rounded-lg border border-danger/40 bg-danger-subtle/50 px-3 py-2 text-xs text-danger-foreground">
              This would take total credits past the agreement&rsquo;s authorised value of{" "}
              <MoneyText paise={contract.reconciliation.currentContractValuePaise} />. At most{" "}
              <MoneyText paise={headroomPaise} /> can be recorded — reduce the amount, or raise an
              amendment to increase the agreement value first.
            </div>
          )}
        </div>

        <SheetFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!canSave}>
            {record.isPending ? "Recording…" : "Record payment"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
