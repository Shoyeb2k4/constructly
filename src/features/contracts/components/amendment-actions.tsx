"use client";

/**
 * Proposing, approving and rejecting an amendment.
 *
 * An amendment is the only thing that moves an agreement's authorised value, and
 * it is deliberately a two-person job: `contracts.edit` raises it,
 * `contracts.amend_approve` decides it. Nothing here writes
 * `currentAmountPaise` — approval calls the existing server action, which applies
 * the delta inside its own transaction.
 *
 * Every figure shown comes from `../amendments` over the reconciliation DTO, so
 * the preview a proposer sees, the figures an approver confirms, and the value
 * the server writes are the same arithmetic.
 */

import * as React from "react";
import { Check, FilePlus2, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { cn } from "@/lib/utils";
import { approveBlockedReason, isStale, previewAmendment } from "../amendments";
import { AMENDMENT_TYPE_LABEL } from "../constants";
import { useApproveAmendment, useProposeAmendment, useRejectAmendment } from "../hooks";
import type { Amendment, AmendmentType, Contract } from "../types";

const AMENDMENT_TYPES: AmendmentType[] = [
  "VARIATION",
  "SCOPE_CHANGE",
  "RATE_CHANGE",
  "TIME_EXTENSION",
  "OTHER",
];

const todayISO = () => new Date().toLocaleDateString("en-CA");

/* ── Propose ────────────────────────────────────────────────────────────── */

/**
 * The proposer states the CHANGE, not the new total — "+₹5,00,000" is what was
 * agreed, and a signed delta makes the direction unmistakable. The revised total
 * is derived and shown, and it is the revised total the server stores.
 */
export function ProposeAmendmentSheet({
  open,
  onOpenChange,
  contract,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contract: Contract;
}) {
  const propose = useProposeAmendment();
  const [type, setType] = React.useState<AmendmentType>("VARIATION");
  const [deltaPaiseRaw, setDeltaPaise] = React.useState<number | null>(null);
  const [reason, setReason] = React.useState("");
  const [effectiveDate, setEffectiveDate] = React.useState(todayISO());

  const [wasOpen, setWasOpen] = React.useState(false);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setType("VARIATION");
      setDeltaPaise(null);
      setReason("");
      setEffectiveDate(todayISO());
    }
  }

  const r = contract.reconciliation;
  const deltaPaise = deltaPaiseRaw ?? 0;
  const revisedAmountPaise = r.currentContractValuePaise + deltaPaise;
  const preview = previewAmendment({ revisedAmountPaise, reconciliation: r });

  const entered = deltaPaiseRaw != null;
  const canSave =
    entered && !preview.blockedReason && !!reason.trim() && !propose.isPending;

  function submit() {
    if (!canSave) return;
    propose.mutate(
      {
        contractId: contract.id,
        type,
        revisedAmountPaise,
        reason: reason.trim(),
        effectiveDate,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Propose amendment</SheetTitle>
          <SheetDescription>
            {contract.title} · {contract.projectName}. The agreed value is never edited in
            place — an amendment records what changed, why, and who approved it.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="space-y-1.5">
            <Label htmlFor="amendment-delta">Change to the agreement value</Label>
            <MoneyInput
              id="amendment-delta"
              value={deltaPaiseRaw}
              onValueChange={setDeltaPaise}
              // The one money field in the product with genuine signed
              // semantics: an amendment can reduce an agreement as well as
              // raise it, so a minus is meaningful here and nowhere else.
              allowNegative
              placeholder="5,00,000 for extra work, -3,00,000 to reduce it"
              autoFocus
            />
            <p className="text-xs text-foreground-subtle">
              Positive for additional authorised work, negative to reduce the scope.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as AmendmentType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AMENDMENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {AMENDMENT_TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amendment-date">Effective date</Label>
              <Input
                id="amendment-date"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="amendment-reason">Reason</Label>
            <Textarea
              id="amendment-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Additional authorised structural work"
            />
            <p className="text-xs text-foreground-subtle">
              Required — a value change with no stated reason is not auditable.
            </p>
          </div>

          <ValueLadder
            currentPaise={preview.currentAuthorisedPaise}
            deltaPaise={entered ? preview.deltaPaise : 0}
            revisedPaise={entered ? preview.revisedAuthorisedPaise : preview.currentAuthorisedPaise}
            pending
          />

          {entered && preview.blockedReason && (
            <div className="rounded-lg border border-danger/40 bg-danger-subtle/50 px-3 py-2 text-xs text-danger-foreground">
              {preview.blockedReason.split(":").slice(1).join(":").trim() ||
                preview.blockedReason}
            </div>
          )}
        </div>

        <SheetFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSave}>
            {propose.isPending ? "Proposing…" : "Propose amendment"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Original → change → authorised, the three figures kept visibly apart.
 * `pending` marks a proposal that has NOT moved anything yet.
 */
export function ValueLadder({
  currentPaise,
  deltaPaise,
  revisedPaise,
  pending,
}: {
  currentPaise: number;
  deltaPaise: number;
  revisedPaise: number;
  pending?: boolean;
}) {
  return (
    <div className="space-y-1 rounded-lg border border-border bg-surface-muted/50 px-3 py-2 text-sm">
      <div className="flex items-baseline justify-between">
        <span className="text-foreground-muted">Current authorised value</span>
        <MoneyText paise={currentPaise} className="font-mono" />
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-foreground-muted">
          {deltaPaise < 0 ? "Proposed reduction" : "Proposed amendment"}
        </span>
        <span className={cn("font-mono", deltaPaise < 0 ? "text-danger-foreground" : "text-success-foreground")}>
          {deltaPaise > 0 && "+"}
          {deltaPaise < 0 && "−"}
          <MoneyText paise={Math.abs(deltaPaise)} />
        </span>
      </div>
      <div className="flex items-baseline justify-between border-t border-border pt-1">
        <span className="font-medium">{pending ? "If approved" : "New authorised value"}</span>
        <MoneyText paise={revisedPaise} className="font-mono font-semibold" />
      </div>
      {pending && (
        <p className="pt-0.5 text-[11px] text-foreground-subtle">
          A proposed amendment changes nothing until it is approved.
        </p>
      )}
    </div>
  );
}

/* ── Approve ────────────────────────────────────────────────────────────── */

export function ApproveAmendmentDialog({
  contract,
  amendment,
  onOpenChange,
}: {
  contract: Contract;
  amendment: Amendment;
  onOpenChange: (o: boolean) => void;
}) {
  const approve = useApproveAmendment();
  const r = contract.reconciliation;

  // Three separate reasons approval can be refused, each said plainly rather
  // than left to a masked server error.
  const lifecycleBlocked = approveBlockedReason(contract.status);
  const stale = isStale(amendment, r.currentContractValuePaise);
  const preview = previewAmendment({
    revisedAmountPaise: amendment.revisedAmountPaise,
    reconciliation: r,
  });
  const floorBlocked = stale ? null : preview.blockedReason;
  const blocked = lifecycleBlocked ?? (stale ? null : floorBlocked);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve this amendment?</DialogTitle>
          <DialogDescription>
            {contract.title} · {contract.projectName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="text-foreground-muted">{amendment.reason}</p>

          <ValueLadder
            currentPaise={amendment.previousAmountPaise}
            deltaPaise={amendment.deltaPaise}
            revisedPaise={amendment.revisedAmountPaise}
          />

          <p className="text-xs text-foreground-subtle">
            This changes what the agreement AUTHORISES. Earned value stays at{" "}
            <MoneyText paise={r.earnedValuePaise} /> and credited stays at{" "}
            <MoneyText paise={r.totalCreditedPaise} /> — only completing a milestone earns
            anything, and no payment moves.
          </p>

          {stale && (
            <div className="rounded-lg border border-danger/40 bg-danger-subtle/50 px-3 py-2 text-xs text-danger-foreground">
              Another amendment was approved while this one was waiting. It was raised against{" "}
              <MoneyText paise={amendment.previousAmountPaise} />, but the agreement now
              authorises <MoneyText paise={r.currentContractValuePaise} />. Reject this one and
              raise it again against the value that now stands.
            </div>
          )}

          {blocked && (
            <div className="rounded-lg border border-danger/40 bg-danger-subtle/50 px-3 py-2 text-xs text-danger-foreground">
              {blocked.includes(":") ? blocked.split(":").slice(1).join(":").trim() : blocked}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!!blocked || stale || approve.isPending}
            onClick={() => approve.mutate(amendment.id, { onSuccess: () => onOpenChange(false) })}
          >
            {approve.isPending ? "Approving…" : "Approve amendment"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Reject ─────────────────────────────────────────────────────────────── */

export function RejectAmendmentDialog({
  contract,
  amendment,
  onOpenChange,
}: {
  contract: Contract;
  amendment: Amendment;
  onOpenChange: (o: boolean) => void;
}) {
  const reject = useRejectAmendment();
  const [reason, setReason] = React.useState("");

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject this amendment?</DialogTitle>
          <DialogDescription>
            {contract.title} · {contract.projectName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="text-foreground-muted">
            The agreement keeps its current authorised value of{" "}
            <MoneyText paise={contract.reconciliation.currentContractValuePaise} />. The
            amendment stays on record as rejected, with this reason — nothing is deleted.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">Reason</Label>
            <Input
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Variation not agreed with the client"
              autoFocus
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Keep it pending
          </Button>
          <Button
            variant="danger"
            disabled={!reason.trim() || reject.isPending}
            onClick={() =>
              reject.mutate(
                { id: amendment.id, reason: reason.trim() },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            {reject.isPending ? "Rejecting…" : "Reject amendment"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Row controls ───────────────────────────────────────────────────────── */

/** Approve / Reject on a PROPOSED amendment. Omitted without the permission. */
export function AmendmentDecisionButtons({
  contract,
  amendment,
}: {
  contract: Contract;
  amendment: Amendment;
}) {
  const [approving, setApproving] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);

  return (
    <>
      <span className="flex shrink-0 gap-1.5">
        <Button variant="secondary" size="sm" onClick={() => setApproving(true)}>
          <Check className="size-4" />
          Approve
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setRejecting(true)}>
          <X className="size-4" />
          Reject
        </Button>
      </span>
      {approving && (
        <ApproveAmendmentDialog
          contract={contract}
          amendment={amendment}
          onOpenChange={(o) => !o && setApproving(false)}
        />
      )}
      {rejecting && (
        <RejectAmendmentDialog
          contract={contract}
          amendment={amendment}
          onOpenChange={(o) => !o && setRejecting(false)}
        />
      )}
    </>
  );
}

/** The entry point from the agreement's action menu and the Amendments tab. */
export function ProposeAmendmentButton({
  contract,
  size = "sm",
  variant = "secondary",
}: {
  contract: Contract;
  size?: "sm" | "md";
  variant?: "primary" | "secondary" | "ghost";
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <FilePlus2 className="size-4" />
        Propose amendment
      </Button>
      <ProposeAmendmentSheet open={open} onOpenChange={setOpen} contract={contract} />
    </>
  );
}
