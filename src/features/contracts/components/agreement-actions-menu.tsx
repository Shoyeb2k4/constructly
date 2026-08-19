"use client";

/**
 * The action layer for one agreement, inside the Command Centre.
 *
 * Everything here calls an EXISTING server action through an existing hook — no
 * lifecycle rule is re-implemented in React. `../agreement-actions` decides what
 * may be offered (a pure projection of the same rules the server enforces), so
 * the menu never presents an action the domain would refuse. The server re-checks
 * every one of them regardless; these gates are affordance, not authorization.
 *
 * Three things are deliberately kept apart, because the domain keeps them apart:
 *
 *   COMPLETE  a benign physical status change
 *   CANCEL    preserves all financial history; needs a reason and its own permission
 *   DELETE    only ever for an agreement created by mistake and never used
 *
 * Collapsing them into one "remove" would be the fastest way to destroy money
 * that should have been reversed instead.
 */

import * as React from "react";
import {
  CheckCircle2,
  FilePlus2,
  MoreVertical,
  PauseCircle,
  Pencil,
  PlayCircle,
  RotateCcw,
  Trash2,
  Wallet,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
  availableStatusActions,
  canCancelAgreement,
  canDeleteAgreement,
  deleteBlockedReason,
} from "../agreement-actions";
import {
  useCancelContract,
  useDeleteContract,
  useSetContractStatus,
} from "../hooks";
import type { AgreementStatusAction } from "../agreement-actions";
import type { Contract, ContractStatus } from "../types";
import { canProposeAmendment } from "../amendments";
import { ContractFormSheet } from "./contract-form-sheet";
import { ProposeAmendmentSheet } from "./amendment-actions";
import { RecordContractPaymentSheet } from "./record-contract-payment-sheet";

const STATUS_ICON: Partial<Record<ContractStatus, React.ComponentType<{ className?: string }>>> = {
  IN_PROGRESS: PlayCircle,
  ON_HOLD: PauseCircle,
  COMPLETED: CheckCircle2,
  NOT_STARTED: RotateCcw,
  SETTLED: CheckCircle2,
};

export function AgreementActionsMenu({ contract }: { contract: Contract }) {
  const can = useCan();
  const setStatus = useSetContractStatus();

  const [editOpen, setEditOpen] = React.useState(false);
  const [payOpen, setPayOpen] = React.useState(false);
  const [amendOpen, setAmendOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [confirmStatus, setConfirmStatus] = React.useState<AgreementStatusAction | null>(null);

  const canEdit = can("contracts.edit");
  const canComplete = can("contracts.complete");
  const canCancel = can("contracts.cancel") && canCancelAgreement(contract);
  const canDelete = can("contracts.delete");
  const canPay = can("contracts.pay") && contract.status !== "CANCELLED";
  // The ONLY route to a different agreement value — the amount field stays
  // disabled in the edit form, so this is where a user is sent instead.
  const canAmend = can("contracts.edit") && canProposeAmendment(contract.status);

  const statusActions = canComplete ? availableStatusActions(contract) : [];
  const hasAnything =
    canEdit || canPay || canAmend || statusActions.length > 0 || canCancel || canDelete;
  if (!hasAnything) return null;

  function applyStatus(action: AgreementStatusAction) {
    if (action.blockedReason) return;
    if (action.confirm) {
      setConfirmStatus(action);
      return;
    }
    setStatus.mutate({ id: contract.id, status: action.status });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Actions for ${contract.title}`}
            disabled={setStatus.isPending}
          >
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {(canEdit || canPay || canAmend) && (
            <>
              {canEdit && (
                <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                  <Pencil />
                  Edit agreement
                </DropdownMenuItem>
              )}
              {canPay && (
                <DropdownMenuItem onSelect={() => setPayOpen(true)}>
                  <Wallet />
                  Record payment
                </DropdownMenuItem>
              )}
              {canAmend && (
                <DropdownMenuItem onSelect={() => setAmendOpen(true)}>
                  <FilePlus2 />
                  Propose amendment
                </DropdownMenuItem>
              )}
            </>
          )}

          {statusActions.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Status</DropdownMenuLabel>
              {statusActions.map((a) => {
                const Icon = STATUS_ICON[a.status] ?? CheckCircle2;
                return (
                  <DropdownMenuItem
                    key={a.status}
                    disabled={!!a.blockedReason}
                    // Radix fires onSelect before the disabled guard in some
                    // keyboard paths; applyStatus re-checks rather than trusting it.
                    onSelect={() => applyStatus(a)}
                    className={a.blockedReason ? "flex-col items-start gap-0.5" : undefined}
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="size-4" />
                      {a.label}
                    </span>
                    {a.blockedReason && (
                      <span className="pl-6 text-xs text-foreground-subtle">
                        {a.blockedReason}
                      </span>
                    )}
                  </DropdownMenuItem>
                );
              })}
            </>
          )}

          {(canCancel || canDelete) && (
            <>
              <DropdownMenuSeparator />
              {canCancel && (
                <DropdownMenuItem
                  onSelect={() => setCancelOpen(true)}
                  className="text-danger-foreground"
                >
                  <XCircle />
                  Cancel agreement
                </DropdownMenuItem>
              )}
              {/* Delete is offered ONLY for an agreement with no financial
                  history at all. Otherwise it is shown disabled, saying why, so
                  the user is pointed at Cancel rather than left guessing. */}
              {canDelete &&
                (canDeleteAgreement(contract) ? (
                  <DropdownMenuItem
                    onSelect={() => setDeleteOpen(true)}
                    className="text-danger-foreground"
                  >
                    <Trash2 />
                    Delete agreement
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem disabled className="flex-col items-start gap-0.5">
                    <span className="flex items-center gap-2">
                      <Trash2 className="size-4" />
                      Delete agreement
                    </span>
                    <span className="pl-6 text-xs text-foreground-subtle">
                      {deleteBlockedReason(contract)}
                    </span>
                  </DropdownMenuItem>
                ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* The SAME form the create flow uses, in edit mode. The amount field is
          disabled there: the agreement value moves only through an amendment. */}
      {canEdit && (
        <ContractFormSheet open={editOpen} onOpenChange={setEditOpen} contract={contract} />
      )}
      {canPay && (
        <RecordContractPaymentSheet
          open={payOpen}
          onOpenChange={setPayOpen}
          contract={contract}
        />
      )}
      {canAmend && (
        <ProposeAmendmentSheet open={amendOpen} onOpenChange={setAmendOpen} contract={contract} />
      )}
      {canCancel && (
        <CancelAgreementDialog
          contract={contract}
          open={cancelOpen}
          onOpenChange={setCancelOpen}
        />
      )}
      {canDelete && (
        <DeleteAgreementDialog
          contract={contract}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
        />
      )}
      <ConfirmStatusDialog
        contract={contract}
        action={confirmStatus}
        onOpenChange={(o) => !o && setConfirmStatus(null)}
        onConfirm={(status) => {
          setStatus.mutate(
            { id: contract.id, status },
            { onSuccess: () => setConfirmStatus(null) },
          );
        }}
      />
    </>
  );
}

/* ── Cancel ─────────────────────────────────────────────────────────────── */

/**
 * Cancelling freezes the agreement and keeps every payment, milestone and
 * attendance row. A reason is mandatory because the server requires one — this
 * is the audit trail for a commercial arrangement that was called off.
 */
function CancelAgreementDialog({
  contract,
  open,
  onOpenChange,
}: {
  contract: Contract;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  if (!open) return null;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <CancelAgreementForm contract={contract} onOpenChange={onOpenChange} />
    </Dialog>
  );
}

function CancelAgreementForm({
  contract,
  onOpenChange,
}: {
  contract: Contract;
  onOpenChange: (o: boolean) => void;
}) {
  // Mounted only while open, so the reason starts empty each time with no effect.
  const cancel = useCancelContract();
  const [reason, setReason] = React.useState("");

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Cancel this agreement?</DialogTitle>
        <DialogDescription>
          {contract.title} · {contract.projectName}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 text-sm">
        <p className="text-foreground-muted">
          Every payment, milestone and attendance record is kept, and reconciliation stays
          readable — earned value simply freezes where it is. The agreement stops accepting
          new attendance and new payments.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="cancel-reason">Reason</Label>
          <Input
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Client dropped the compound wall from the package"
            autoFocus
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Keep agreement
        </Button>
        <Button
          variant="danger"
          disabled={!reason.trim() || cancel.isPending}
          onClick={() =>
            cancel.mutate(
              { id: contract.id, reason: reason.trim() },
              { onSuccess: () => onOpenChange(false) },
            )
          }
        >
          {cancel.isPending ? "Cancelling…" : "Cancel agreement"}
        </Button>
      </div>
    </DialogContent>
  );
}

/* ── Delete ─────────────────────────────────────────────────────────────── */

function DeleteAgreementDialog({
  contract,
  open,
  onOpenChange,
}: {
  contract: Contract;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const del = useDeleteContract();
  if (!open) return null;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this agreement?</DialogTitle>
          <DialogDescription>
            {contract.title} · {contract.projectName}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-foreground-muted">
          This agreement has no payments, no completed milestones, no attributed labour and no
          approved amendments, so there is nothing to preserve. If any of that had existed the
          right action would be <strong className="font-medium">Cancel</strong>, which keeps it
          all.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Keep agreement
          </Button>
          <Button
            variant="danger"
            disabled={del.isPending}
            onClick={() =>
              del.mutate(contract.id, { onSuccess: () => onOpenChange(false) })
            }
          >
            {del.isPending ? "Deleting…" : "Delete agreement"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Confirmed status changes ───────────────────────────────────────────── */

/**
 * Closing out as SETTLED and moving back to NOT_STARTED both restate where the
 * agreement stands commercially, so neither happens on a single menu click.
 */
function ConfirmStatusDialog({
  contract,
  action,
  onOpenChange,
  onConfirm,
}: {
  contract: Contract;
  action: AgreementStatusAction | null;
  onOpenChange: (o: boolean) => void;
  onConfirm: (status: ContractStatus) => void;
}) {
  if (!action) return null;
  const settling = action.status === "SETTLED";
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action.label}?</DialogTitle>
          <DialogDescription>
            {contract.title} · {contract.projectName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm text-foreground-muted">
          {settling ? (
            <>
              <p>
                Closing out records that the whole agreement is delivered and exactly
                reconciled — every milestone complete, and{" "}
                <MoneyText paise={contract.reconciliation.currentContractValuePaise} /> both
                earned and credited.
              </p>
              <p>It stops accepting new attendance. Reversing it means moving it back to completed.</p>
            </>
          ) : (
            <p>
              This moves the agreement back to not started. Nothing financial is deleted —
              recorded payments, milestones and attendance all stay exactly as they are.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onConfirm(action.status)}>
            {action.label}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
