"use client";

/**
 * Undo a re-scope, before the moved money has been spent.
 *
 * Pass 10B shipped `reverseAdvanceRescope` across the server, the demo store and
 * a hook — with no way to reach it. A governed money correction that cannot be
 * undone leaves an Owner who mis-scoped with only a second forward move, which
 * reads in History as two transfers rather than a mistake and its correction.
 *
 * What this deliberately does NOT do:
 *
 *   - invent a partial unwind. The server refuses once any of the transferred
 *     money has been consumed, because deciding WHICH half came back would be
 *     the UI making a financial judgement. The refusal is surfaced verbatim.
 *   - move cash. A reversal restores availability, exactly as the re-scope moved
 *     it. Both are stated on the dialog, because a reader watching money jump
 *     between scopes deserves to be told the bank balance did not change.
 */

import * as React from "react";
import { Undo2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/patterns/field";
import { Callout } from "@/components/patterns/callout";
import { MoneyText } from "@/components/patterns/money-text";
import { useReverseAdvanceRescope } from "../hooks";
import { describeRescopeBlocker } from "../advance-rescope";
import type { ContractorLedgerEntry } from "../types";

const REASONS = [
  "Re-scoped in error",
  "Wrong target scope chosen",
  "Agreement reinstated",
  "Approved in error",
];

export function ReverseRescopeDialog({
  transfer,
  fromLabel,
  toLabel,
  onOpenChange,
}: {
  /** The SCOPE_TRANSFER_OUT row being undone. `null` closes the dialog. */
  transfer: ContractorLedgerEntry | null;
  /** Scope the money came FROM — restored by the reversal. */
  fromLabel: string;
  /** Scope it went TO — loses the availability again. */
  toLabel: string;
  onOpenChange: (open: boolean) => void;
}) {
  const reverse = useReverseAdvanceRescope();
  const [reason, setReason] = React.useState("");
  const [blockers, setBlockers] = React.useState<string[] | null>(null);

  // Reset per transfer, so a refusal from one row never greets the next.
  // Derived during render rather than in an effect — the same pattern the rest
  // of the app uses to reseed a form from changing props.
  const transferId = transfer?.id ?? null;
  const [seenTransferId, setSeenTransferId] = React.useState(transferId);
  if (seenTransferId !== transferId) {
    setSeenTransferId(transferId);
    setReason("");
    setBlockers(null);
  }

  if (!transfer) return null;

  const trimmed = reason.trim();

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reverse re-scope</DialogTitle>
          <DialogDescription>
            Puts this money back where it was. No cash moves, nothing already recorded changes,
            and both events stay on the record.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-surface-muted p-3 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">
              This re-scope
            </p>
            <p className="mt-1.5 font-medium">
              {fromLabel} <span className="text-foreground-subtle">→</span> {toLabel}
            </p>
            <dl className="mt-2 space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="min-w-0 text-foreground-muted">Amount moved</dt>
                <dd className="shrink-0 font-mono tabular-nums">
                  <MoneyText paise={transfer.amountPaise} />
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="min-w-0 text-foreground-muted">Cash impact</dt>
                <dd className="shrink-0 font-mono tabular-nums">₹0</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="min-w-0 text-foreground-muted">Total advance balance</dt>
                <dd className="shrink-0 text-foreground-muted">unchanged</dd>
              </div>
            </dl>
          </div>

          <Callout tone="info" title={`Availability returns to ${fromLabel}`}>
            {toLabel} loses this availability again. Only money no settlement has used can be put
            back — if part of it has already been spent, the reversal is refused rather than
            guessing which part returned.
          </Callout>

          <Field
            label="Reason"
            required
            hint="Recorded on the audit trail beside the original re-scope."
          >
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this being reversed?"
            />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className="rounded-full border border-border px-2.5 py-1 text-xs text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {r}
              </button>
            ))}
          </div>

          {blockers && blockers.length > 0 && (
            <Callout tone="blocked" title="This re-scope can't be reversed">
              {describeRescopeBlocker(blockers[0])}
            </Callout>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!trimmed || reverse.isPending}
            onClick={() =>
              reverse.mutate(
                { transferId: transfer.id, reason: trimmed },
                {
                  onSuccess: (res) => {
                    // The server answers a refusal as data, not as an error, so
                    // the dialog stays open and shows why.
                    if ("blockers" in res) setBlockers(res.blockers);
                    else onOpenChange(false);
                  },
                },
              )
            }
          >
            <Undo2 />
            {reverse.isPending ? "Reversing…" : "Reverse re-scope"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
