"use client";

/**
 * Confirm copying the previous working day onto this sheet.
 *
 * The button used to fire immediately and report "Copied from the previous
 * working day" — which said neither what arrived nor what did not. The operation
 * carries four rules an operator has a right to know BEFORE it runs, all of them
 * existing behaviour that this dialog only states:
 *
 *   • the source is the most recent day WITH attendance, not literally yesterday
 *   • rows already on this date, for the same labour type / contractor /
 *     agreement, are REPLACED
 *   • contractors archived since are SKIPPED — otherwise copying would be a way
 *     to create new attendance for a contractor the server refuses
 *   • rates are re-snapshotted as at THIS date; a copy is a new recording and
 *     inherits nothing from the source row, including its settlement
 *
 * Nothing here changes the mutation. It explains it, and then reports what the
 * returned sheet actually contains.
 */

import * as React from "react";
import { CopyPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/patterns/callout";
import type { AttendanceSheet } from "../../types";

export function CopyPreviousDayDialog({
  open,
  onOpenChange,
  /** Current sheet, used to say whether anything is about to be replaced. */
  sheet,
  isPending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sheet: AttendanceSheet | undefined;
  isPending: boolean;
  onConfirm: () => void;
}) {
  const alreadyRecorded = sheet?.totalPresent ?? 0;
  const archivedGroups = (sheet?.groups ?? []).filter((g) => g.archived);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy the previous working day</DialogTitle>
          <DialogDescription>
            Brings forward the most recent day that has attendance — which may not be yesterday.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <ul className="space-y-1.5 text-foreground-muted">
            <li>
              Rates are taken as they stand <strong className="font-medium text-foreground">today</strong>
              , not as they were on the day being copied — a copy is a new recording.
            </li>
            <li>
              Contractors archived since then are{" "}
              <strong className="font-medium text-foreground">skipped</strong>. Their existing rows
              stay exactly as they are.
            </li>
          </ul>

          {alreadyRecorded > 0 && (
            <Callout tone="attention" title="This day already has attendance">
              {alreadyRecorded} recorded so far. Any labour type that also appears on the copied day
              — for the same contractor and agreement — will be{" "}
              <strong className="font-medium">replaced</strong>. Anything else is left alone.
            </Callout>
          )}

          {archivedGroups.length > 0 && (
            <Callout tone="neutral" title="Archived contractors on this sheet">
              {archivedGroups.map((g) => g.contractorName).join(", ")} — nothing new will be copied
              for {archivedGroups.length === 1 ? "them" : "these"}.
            </Callout>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={isPending} onClick={onConfirm}>
            <CopyPlus />
            {isPending ? "Copying…" : "Copy previous day"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
