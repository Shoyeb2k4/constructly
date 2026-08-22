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
import { MoneyInput } from "@/components/patterns/money-input";
import { useProjects } from "@/features/projects/hooks";
import { useContractors } from "@/features/contractors/hooks";
import { useCreateContract, useUpdateContract } from "../hooks";
import type { Contract } from "../types";

/**
 * Create or edit a fixed contract. In CREATE mode, either `contractorId` or
 * `projectId` may be pre-selected (and locked) from the surrounding context; the
 * other is chosen here. In EDIT mode (`contract` provided), party/project are
 * fixed and only the work fields are editable.
 */
export function ContractFormSheet({
  open,
  onOpenChange,
  contract,
  contractorId,
  projectId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contract?: Contract;
  contractorId?: string;
  projectId?: string;
  /** Fires on a successful CREATE, so the caller can reveal the new agreement. */
  onCreated?: (created: Contract) => void;
}) {
  const isEdit = !!contract;
  const create = useCreateContract();
  const update = useUpdateContract();
  const { data: projects = [] } = useProjects({});
  const { data: contractors = [] } = useContractors({});

  const [ctorId, setCtorId] = React.useState(contractorId ?? "");
  const [projId, setProjId] = React.useState(projectId ?? "");
  const [title, setTitle] = React.useState("");
  const [scope, setScope] = React.useState("");
  const [quantity, setQuantity] = React.useState("");
  const [unit, setUnit] = React.useState("");
  const [amountPaiseRaw, setAmountPaise] = React.useState<number | null>(null);
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [notes, setNotes] = React.useState("");

  // Reset on each open (re-apply defaults / the edited contract's values).
  const [wasOpen, setWasOpen] = React.useState(false);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setCtorId(contract?.contractorId ?? contractorId ?? "");
      setProjId(contract?.projectId ?? projectId ?? "");
      setTitle(contract?.title ?? "");
      setScope(contract?.scope ?? "");
      setQuantity(contract?.quantity != null ? String(contract.quantity) : "");
      setUnit(contract?.unit ?? "");
      // Editing shows the ORIGINAL agreed value; the amount field is disabled
      // in edit mode because value changes go through an amendment.
      // Paise straight through — no rupee string in between to round.
      setAmountPaise(contract ? contract.originalAmountPaise : null);
      setStartDate(contract?.startDate ?? "");
      setEndDate(contract?.expectedCompletionDate ?? "");
      setNotes(contract?.notes ?? "");
    }
  }

  const amountPaise = amountPaiseRaw ?? 0;
  const pending = create.isPending || update.isPending;
  const canSave =
    !!title.trim() && (isEdit || amountPaise > 0) && !!ctorId && !!projId && !pending;

  function submit() {
    if (!canSave) return;
    const common = {
      title: title.trim(),
      scope: scope.trim() || null,
      quantity: quantity.trim() ? Number(quantity) : null,
      unit: unit.trim() || null,
      startDate: startDate || null,
      expectedCompletionDate: endDate || null,
      notes: notes.trim() || null,
    };
    if (isEdit) {
      // No amount: the agreement's value changes only through a proposed and
      // approved amendment, so every change carries a reason and an approver.
      update.mutate(
        { id: contract!.id, patch: common },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      create.mutate(
        { contractorId: ctorId, projectId: projId, contractAmountPaise: amountPaise, ...common },
        {
          onSuccess: (created) => {
            onOpenChange(false);
            onCreated?.(created);
          },
        },
      );
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit agreement" : "New agreement"}</SheetTitle>
          <SheetDescription>
            A contractor&rsquo;s commercial work package on a project. Its value is authoritative
            and never derived from headcount; once created it changes only through an amendment.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {!contractorId && !isEdit && (
            <div className="space-y-1.5">
              <Label>Contractor</Label>
              <Select value={ctorId} onValueChange={setCtorId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select contractor" /></SelectTrigger>
                <SelectContent>
                  {contractors.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {!projectId && !isEdit && (
            <div className="space-y-1.5">
              <Label>Project</Label>
              <Select value={projId} onValueChange={setProjId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  {projects.filter((p) => !p.archivedAt).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Work title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Complete Plumbing Work" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Scope (optional)</Label>
            <Textarea value={scope} onChange={(e) => setScope(e.target.value)} placeholder="e.g. Plumbing for 20 bathrooms" rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Quantity (optional)</Label>
              <Input type="number" min={0} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="e.g. 20" />
            </div>
            <div className="space-y-1.5">
              <Label>Unit (optional)</Label>
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. Bathrooms" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Contract amount</Label>
            <MoneyInput
              value={amountPaiseRaw}
              onValueChange={setAmountPaise}
              placeholder="60,00,000"
              disabled={isEdit}
            />
            {isEdit && (
              <p className="text-xs text-foreground-subtle">
                Agreement value changes are made through <strong className="font-medium">Amendments</strong>,
                so the originally signed figure is preserved. Use{" "}
                <strong className="font-medium">Propose amendment</strong> in the agreement&rsquo;s
                action menu — it needs a reason, an effective date and an approver.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start date (optional)</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Expected completion (optional)</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <SheetFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!canSave}>
            {pending ? "Saving…" : isEdit ? "Save changes" : "Create agreement"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
