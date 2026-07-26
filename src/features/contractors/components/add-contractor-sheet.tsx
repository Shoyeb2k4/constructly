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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toPaise } from "@/lib/money";
import { useCreateContractor, useUpdateContractor } from "../hooks";
import type { Contractor } from "../types";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-foreground-subtle">{hint}</p>}
    </div>
  );
}

export function AddContractorSheet({
  open,
  onOpenChange,
  contractor,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** When set, the sheet edits this contractor instead of creating one. */
  contractor?: Contractor;
}) {
  const editing = !!contractor;
  const create = useCreateContractor();
  const update = useUpdateContractor();

  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [openingRupees, setOpeningRupees] = React.useState("");
  const [status, setStatus] = React.useState<"ACTIVE" | "INACTIVE">("ACTIVE");

  // Re-seed the form whenever the target changes (derive-during-render).
  const [key, setKey] = React.useState<string | null>(null);
  const target = contractor?.id ?? "new";
  if (key !== target) {
    setKey(target);
    setName(contractor?.name ?? "");
    setPhone(contractor?.phone ?? "");
    setOpeningRupees("");
    setStatus(contractor?.status ?? "ACTIVE");
  }

  const pending = create.isPending || update.isPending;
  const canSave = name.trim().length > 0 && !pending;

  function submit() {
    if (!canSave) return;
    if (editing) {
      update.mutate(
        { id: contractor!.id, patch: { name: name.trim(), phone: phone.trim() || null, status } },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      const opening = openingRupees.trim() ? toPaise(Number(openingRupees) || 0) : undefined;
      create.mutate(
        { name: name.trim(), phone: phone.trim() || null, openingAdvancePaise: opening },
        { onSuccess: () => onOpenChange(false) },
      );
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{editing ? "Edit contractor" : "Add contractor"}</SheetTitle>
          <SheetDescription>
            {editing
              ? "Update the contractor's details."
              : "A labour contractor you pay weekly against advances."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ramesh Construction Crew" />
          </Field>
          <Field label="Mobile">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 …" inputMode="tel" />
          </Field>
          {editing ? (
            <Field label="Status">
              <Select value={status} onValueChange={(v) => setStatus(v as "ACTIVE" | "INACTIVE")}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field label="Opening advance (₹)" hint="Optional — an advance already paid before using the app.">
              <Input
                type="number"
                min={0}
                value={openingRupees}
                onChange={(e) => setOpeningRupees(e.target.value)}
                placeholder="0"
              />
            </Field>
          )}
        </div>

        <SheetFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!canSave}>
            {editing ? "Save" : "Add contractor"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
