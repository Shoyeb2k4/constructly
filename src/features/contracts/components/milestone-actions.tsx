"use client";

/**
 * Per-milestone actions, and the dialogs that make their financial effect plain
 * BEFORE the user commits.
 *
 * The load-bearing one is completion. Completing a milestone recognises earned
 * value against the agreement's authorised ceiling; it moves no money and
 * allocates no existing payment to the checkpoint. The confirmation therefore
 * shows earned before/after and the resulting Due or Ahead position, all read
 * from the shared engine via `previewMilestoneCompletion` and never recomputed
 * here.
 *
 * Reopening is the auditable correction path (COMPLETED → IN_PROGRESS, the one
 * legal move out of COMPLETED). It REDUCES earned value, so it confirms too, and
 * the server writes the before/after to the activity log. Nothing is deleted.
 */

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  MoreVertical,
  Pencil,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useCan } from "@/features/rbac/permission-context";
import {
  availableMilestoneActions,
  deleteMilestoneBlockedReason,
  previewMilestoneCompletion,
} from "../milestones";
import { useDeleteMilestone, useSetMilestoneStatus } from "../hooks";
import type { MilestoneAction } from "../milestones";
import type { Contract, Milestone, MilestoneStatus } from "../types";
import { MilestoneFormSheet } from "./milestone-form-sheet";

const STATUS_ICON: Record<MilestoneStatus, React.ComponentType<{ className?: string }>> = {
  NOT_STARTED: RotateCcw,
  IN_PROGRESS: RotateCcw,
  COMPLETED: CheckCircle2,
  CANCELLED: XCircle,
};

export function MilestoneActionsMenu({
  contract,
  milestone,
  onMoveUp,
  onMoveDown,
}: {
  contract: Contract;
  milestone: Milestone;
  /** Omitted when this row cannot move that way, or the viewer cannot reorder. */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const can = useCan();
  const setStatus = useSetMilestoneStatus();

  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [confirming, setConfirming] = React.useState<MilestoneAction | null>(null);

  const canEdit = can("contracts.edit");
  const canComplete = can("contracts.complete");

  const statusActions = canComplete ? availableMilestoneActions(milestone, contract.status) : [];
  const deleteBlocked = deleteMilestoneBlockedReason(milestone, contract.status);
  const canReorder = canEdit && (!!onMoveUp || !!onMoveDown);

  if (!canEdit && statusActions.length === 0) return null;

  function apply(action: MilestoneAction) {
    if (action.confirm || action.requiresReason) {
      setConfirming(action);
      return;
    }
    setStatus.mutate({ id: milestone.id, status: action.status });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Actions for ${milestone.title}`}
            disabled={setStatus.isPending}
          >
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {statusActions.map((a) => {
            const Icon = STATUS_ICON[a.status];
            return (
              <DropdownMenuItem key={a.status} onSelect={() => apply(a)}>
                <Icon className="size-4" />
                {a.label}
              </DropdownMenuItem>
            );
          })}

          {canEdit && (
            <>
              {statusActions.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                <Pencil />
                Edit milestone
              </DropdownMenuItem>
              {canReorder && (
                <>
                  <DropdownMenuItem disabled={!onMoveUp} onSelect={() => onMoveUp?.()}>
                    <ArrowUp />
                    Move up
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!onMoveDown} onSelect={() => onMoveDown?.()}>
                    <ArrowDown />
                    Move down
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              {/* Deleting is only ever for a milestone that never started and
                  carries no payments; otherwise it is shown disabled, saying why,
                  so the user is pointed at Cancel rather than left guessing. */}
              {deleteBlocked ? (
                <DropdownMenuItem disabled className="flex-col items-start gap-0.5">
                  <span className="flex items-center gap-2">
                    <Trash2 className="size-4" />
                    Delete milestone
                  </span>
                  <span className="pl-6 text-xs text-foreground-subtle">{deleteBlocked}</span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onSelect={() => setDeleteOpen(true)}
                  className="text-danger-foreground"
                >
                  <Trash2 />
                  Delete milestone
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canEdit && (
        <MilestoneFormSheet
          open={editOpen}
          onOpenChange={setEditOpen}
          contract={contract}
          milestone={milestone}
        />
      )}
      {canEdit && deleteOpen && (
        <DeleteMilestoneDialog
          milestone={milestone}
          onOpenChange={(o) => !o && setDeleteOpen(false)}
        />
      )}
      {confirming && (
        <ConfirmMilestoneStatusDialog
          contract={contract}
          milestone={milestone}
          action={confirming}
          onOpenChange={(o) => !o && setConfirming(null)}
        />
      )}
    </>
  );
}

/* ── Status confirmation ────────────────────────────────────────────────── */

function ConfirmMilestoneStatusDialog({
  contract,
  milestone,
  action,
  onOpenChange,
}: {
  contract: Contract;
  milestone: Milestone;
  action: MilestoneAction;
  onOpenChange: (o: boolean) => void;
}) {
  const setStatus = useSetMilestoneStatus();
  const [reason, setReason] = React.useState("");

  const completing = action.status === "COMPLETED";
  const reopening = milestone.status === "COMPLETED" && action.status === "IN_PROGRESS";

  // Engine-derived. `previewMilestoneCompletion` reuses `positionFor` — the very
  // function the reconciliation statement's Due/Ahead lines are built from.
  const preview = previewMilestoneCompletion({
    reconciliation: contract.reconciliation,
    milestoneValuePaise: milestone.valuePaise,
  });

  const blocked = completing ? preview.blockedReason : null;
  const canSubmit = !blocked && (!action.requiresReason || !!reason.trim()) && !setStatus.isPending;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action.label}?</DialogTitle>
          <DialogDescription>
            {milestone.title} · {contract.title} · {contract.projectName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {completing && (
            <>
              <p className="text-foreground-muted">
                Completing &ldquo;{milestone.title}&rdquo; will increase cumulative earned value by{" "}
                <MoneyText paise={milestone.valuePaise} className="font-medium text-foreground" />.
                No payment is moved, and no existing payment is attached to this checkpoint.
              </p>
              <EffectTable preview={preview} />
            </>
          )}

          {reopening && (
            <>
              <p className="text-foreground-muted">
                Reopening un-recognises this checkpoint&rsquo;s{" "}
                <MoneyText paise={milestone.valuePaise} className="font-medium text-foreground" /> of
                earned value. The milestone stays on record and the correction is written to
                history — nothing is deleted, and no payment is touched.
              </p>
              <div className="rounded-lg bg-surface-muted/50 px-3 py-2">
                <Row
                  label="Earned value"
                  from={preview.earnedBeforePaise}
                  to={Math.max(0, preview.earnedBeforePaise - milestone.valuePaise)}
                />
              </div>
            </>
          )}

          {action.status === "CANCELLED" && (
            <p className="text-foreground-muted">
              A cancelled milestone never counts towards earned value and drops out of the
              agreement&rsquo;s planned coverage. The record is kept.
            </p>
          )}

          {!completing && !reopening && action.status !== "CANCELLED" && (
            <p className="text-foreground-muted">
              This changes physical progress only. Earned value is unaffected until a milestone is
              completed.
            </p>
          )}

          {blocked && (
            <div className="rounded-lg border border-danger/40 bg-danger-subtle/50 px-3 py-2 text-xs text-danger-foreground">
              {blocked}
            </div>
          )}

          {action.requiresReason && (
            <div className="space-y-1.5">
              <Label htmlFor="milestone-reason">Reason</Label>
              <Input
                id="milestone-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Slab dropped from the package"
                autoFocus
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={action.status === "CANCELLED" ? "danger" : "primary"}
            disabled={!canSubmit}
            onClick={() =>
              setStatus.mutate(
                {
                  id: milestone.id,
                  status: action.status,
                  reason: action.requiresReason ? reason.trim() : null,
                },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            {setStatus.isPending ? "Saving…" : action.label}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Earned / credited / position, before and after. */
function EffectTable({ preview }: { preview: ReturnType<typeof previewMilestoneCompletion> }) {
  return (
    <div className="space-y-1 rounded-lg bg-surface-muted/50 px-3 py-2">
      <Row label="Earned value" from={preview.earnedBeforePaise} to={preview.earnedAfterPaise} />
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-foreground-muted">Already credited</span>
        <MoneyText paise={preview.creditedPaise} className="font-mono" />
      </div>
      {preview.dueAfterPaise > 0 ? (
        <Row
          label="Currently due"
          from={preview.dueBeforePaise}
          to={preview.dueAfterPaise}
          tone="text-warning-foreground"
        />
      ) : (
        <Row label="Paid ahead" from={preview.aheadBeforePaise} to={preview.aheadAfterPaise} />
      )}
    </div>
  );
}

function Row({
  label,
  from,
  to,
  tone,
}: {
  label: string;
  from: number;
  to: number;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between text-xs">
      <span className="text-foreground-muted">{label}</span>
      <span className="font-mono">
        <MoneyText paise={from} className="text-foreground-subtle" />
        <span className="mx-1 text-foreground-subtle">→</span>
        <MoneyText paise={to} className={tone ?? "font-medium"} />
      </span>
    </div>
  );
}

/* ── Delete ─────────────────────────────────────────────────────────────── */

function DeleteMilestoneDialog({
  milestone,
  onOpenChange,
}: {
  milestone: Milestone;
  onOpenChange: (o: boolean) => void;
}) {
  const del = useDeleteMilestone();
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this milestone?</DialogTitle>
          <DialogDescription>{milestone.title}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-foreground-muted">
          It has not started and carries no payments, so nothing is lost. A milestone with any
          history is cancelled instead, which keeps it on record.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Keep milestone
          </Button>
          <Button
            variant="danger"
            disabled={del.isPending}
            onClick={() => del.mutate(milestone.id, { onSuccess: () => onOpenChange(false) })}
          >
            {del.isPending ? "Deleting…" : "Delete milestone"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
