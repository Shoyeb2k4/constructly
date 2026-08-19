"use client";

/**
 * Recording and reversing an AGREEMENT payment, from the Payments tab.
 *
 * "Agreement payment" is one of three distinct instruments the Command Centre
 * shows, and this file touches only that one. A labour advance (cash pre-paying
 * future attendance) and a settlement (the recognition of attendance already
 * worked) have their own flows and their own ledger, deliberately — merging them
 * is how the same money gets recorded twice.
 *
 * Reversal is never a delete. The payment keeps its row, its reason and its audit
 * entry; it simply stops counting towards every total from that point on.
 */

import * as React from "react";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyText } from "@/components/patterns/money-text";
import { formatDate } from "@/features/projects/format";
import { useReverseContractPayment } from "../hooks";
import { CONTRACT_STATUS_LABEL, PAYMENT_TYPE_LABEL } from "../constants";
import type { Contract, ContractPaymentHistoryRow } from "../types";
import { RecordContractPaymentSheet } from "./record-contract-payment-sheet";

/* ── Record ─────────────────────────────────────────────────────────────── */

/**
 * A payment always belongs to ONE agreement, so this never guesses. With a single
 * payable agreement it opens straight onto it; with several it asks which one
 * first, naming the project and what is currently due on each.
 *
 * A cancelled agreement is not offered — the server refuses a payment against one
 * (AGREEMENT_CANCELLED).
 */
export function RecordPaymentLauncher({
  contracts,
  size = "sm",
}: {
  contracts: Contract[];
  size?: "sm" | "md";
}) {
  const payable = contracts.filter((c) => c.status !== "CANCELLED");
  const [choosing, setChoosing] = React.useState(false);
  const [target, setTarget] = React.useState<Contract | null>(null);

  if (payable.length === 0) return null;

  return (
    <>
      <Button
        variant="secondary"
        size={size}
        onClick={() => (payable.length === 1 ? setTarget(payable[0]) : setChoosing(true))}
      >
        <Wallet className="size-4" />
        Record payment
      </Button>

      {choosing && (
        <Dialog open onOpenChange={(o) => !o && setChoosing(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Which agreement is this payment against?</DialogTitle>
              <DialogDescription>
                Payments credit one agreement. They are never split across several.
              </DialogDescription>
            </DialogHeader>
            <div className="overflow-hidden rounded-xl border border-border">
              {payable.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setChoosing(false);
                    setTarget(c);
                  }}
                  className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2.5 text-left text-sm transition-colors last:border-0 hover:bg-surface-muted/60"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.title}</span>
                    <span className="text-xs text-foreground-subtle">
                      {c.projectName} · {CONTRACT_STATUS_LABEL[c.status]}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-foreground-subtle">
                    {c.reconciliation.currentDuePaise > 0 ? (
                      <>
                        Due{" "}
                        <MoneyText
                          paise={c.reconciliation.currentDuePaise}
                          className="font-mono text-warning-foreground"
                        />
                      </>
                    ) : (
                      <>
                        Ahead{" "}
                        <MoneyText
                          paise={c.reconciliation.advanceCreditPaise}
                          className="font-mono"
                        />
                      </>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {target && (
        <RecordContractPaymentSheet
          open
          onOpenChange={(o) => !o && setTarget(null)}
          contract={target}
        />
      )}
    </>
  );
}

/* ── Reverse ────────────────────────────────────────────────────────────── */

/** The row control. Rendered only for a payment that is still live. */
export function ReversePaymentButton({
  payment,
  onSelect,
}: {
  payment: ContractPaymentHistoryRow;
  onSelect: (p: ContractPaymentHistoryRow) => void;
}) {
  // An already-reversed payment offers nothing: reversing twice is meaningless
  // and the server refuses it.
  if (payment.reversedAt != null) return null;
  return (
    <button
      type="button"
      onClick={() => onSelect(payment)}
      className="rounded-md border border-border px-2 py-1 text-xs text-foreground-muted transition-colors hover:bg-surface-muted"
    >
      Reverse
    </button>
  );
}

export function ReverseContractPaymentDialog({
  payment,
  onOpenChange,
}: {
  payment: ContractPaymentHistoryRow | null;
  onOpenChange: (o: boolean) => void;
}) {
  if (!payment) return null;
  // Mounted only while open, so the reason field starts empty each time without
  // an effect resetting it.
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <ReverseForm payment={payment} onOpenChange={onOpenChange} />
    </Dialog>
  );
}

function ReverseForm({
  payment,
  onOpenChange,
}: {
  payment: ContractPaymentHistoryRow;
  onOpenChange: (o: boolean) => void;
}) {
  const reverse = useReverseContractPayment();
  const [reason, setReason] = React.useState("");

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Reverse this payment?</DialogTitle>
        <DialogDescription>
          {PAYMENT_TYPE_LABEL[payment.type]} · {formatDate(payment.date)} ·{" "}
          {payment.contractTitle} · {payment.projectName}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 text-sm">
        <p className="text-foreground-muted">
          The payment stays on record, struck through, with this reason attached. Its{" "}
          <MoneyText paise={payment.amountPaise} /> stops counting towards the agreement&rsquo;s
          credited total from now on, so what is currently due goes back up by the same amount.
          Nothing is deleted.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="payment-reversal-reason">Reason</Label>
          <Input
            id="payment-reversal-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Recorded against the wrong agreement"
            autoFocus
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Keep payment
        </Button>
        <Button
          variant="danger"
          disabled={!reason.trim() || reverse.isPending}
          onClick={() =>
            reverse.mutate(
              { id: payment.id, reason: reason.trim() },
              { onSuccess: () => onOpenChange(false) },
            )
          }
        >
          {reverse.isPending ? "Reversing…" : "Reverse payment"}
        </Button>
      </div>
    </DialogContent>
  );
}
