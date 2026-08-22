"use client";

/**
 * One dialog for every destructive control, driven by the delete matrix.
 *
 * Before this existed, each screen wrote its own confirmation copy, and the
 * quality tracked whoever happened to write it: the agreement menu explained
 * exactly why Cancel differs from Delete, while a vendor payment offered
 * "Delete this payment?" for an operation the domain refuses outright.
 *
 * The dialog reads `DELETE_POLICY` rather than accepting free text, so the
 * button says what actually happens — "Reverse settlement", never "Delete" —
 * and an entity the domain refuses gets an explanation with no destructive
 * button at all. A screen can still add its own detail (a reason field, an
 * impact preview) as children; what it cannot do is rename the outcome.
 */

import * as React from "react";
import { AlertTriangle, Ban, Info, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deletePolicy, type GovernedEntity } from "../delete-policy";

const ICON = {
  HARD_DELETE: Trash2,
  SOFT_DELETE: Trash2,
  ARCHIVE: Ban,
  CANCEL: Ban,
  REVERSE: RotateCcw,
  REFUSE: Info,
} as const;

export function GovernedDeleteDialog({
  entity,
  open,
  onOpenChange,
  subject,
  blockedReason,
  onConfirm,
  pending,
  confirmDisabled,
  children,
}: {
  entity: GovernedEntity;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** What is being acted on — a PO number, an agreement title, an amount. */
  subject?: React.ReactNode;
  /**
   * A concrete reason the domain will refuse THIS record, discovered by the
   * screen (e.g. "3 payments recorded against it"). Turns any outcome into a
   * refusal, which is the honest thing to show rather than a button that fails.
   */
  blockedReason?: string | null;
  onConfirm?: () => void;
  pending?: boolean;
  confirmDisabled?: boolean;
  children?: React.ReactNode;
}) {
  const policy = deletePolicy(entity);
  const refused = policy.outcome === "REFUSE" || !!blockedReason || !onConfirm;
  const Icon = refused ? Info : ICON[policy.outcome];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="size-4 shrink-0" aria-hidden />
            {refused ? refusalTitle(policy.label) : `${policy.label}?`}
          </DialogTitle>
          {subject && <DialogDescription>{subject}</DialogDescription>}
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {blockedReason && (
            <p className="flex gap-2 rounded-lg bg-warning-subtle px-3 py-2 text-warning-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{blockedReason}</span>
            </p>
          )}
          <p className="text-foreground-muted">{policy.explains}</p>
          {!refused && policy.recoverable && (
            <p className="text-foreground-subtle">This can be undone.</p>
          )}
          {children}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {/* Not "Close": the dialog's own dismiss control already carries
                that name, and two buttons reading "Close" is a maze to anyone
                hearing the page rather than seeing it. */}
            {refused ? "Got it" : "Keep it"}
          </Button>
          {!refused && (
            <Button variant="danger" onClick={onConfirm} disabled={pending || confirmDisabled}>
              {policy.label}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A refusal is titled by what the record IS, not by the button the user
 * pressed — "Vendor payment recorded" reads as a statement of fact, where
 * "Delete this payment?" would pose a question the product will not answer.
 */
function refusalTitle(label: string) {
  return /^(delete|remove|cancel|reverse|archive)\b/i.test(label) ? `${label} isn't possible` : label;
}
