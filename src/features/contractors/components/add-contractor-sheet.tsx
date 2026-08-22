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
import { MoneyInput } from "@/components/patterns/money-input";
import { useCreateContractor, useUpdateContractor } from "../hooks";
import { describeDuplicates, type DuplicateMatch } from "../lifecycle";
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
  const [openingPaise, setOpeningPaise] = React.useState<number | null>(null);
  // Look-alikes the server found. A QUESTION, not a refusal: two different crews
  // can share a name, so the user confirms and we retry with allowDuplicate.
  const [duplicates, setDuplicates] = React.useState<DuplicateMatch[]>([]);

  // Re-seed the form whenever the target changes (derive-during-render).
  const [key, setKey] = React.useState<string | null>(null);
  const target = contractor?.id ?? "new";
  if (key !== target) {
    setKey(target);
    setName(contractor?.name ?? "");
    setPhone(contractor?.phone ?? "");
    setOpeningPaise(null);
    setDuplicates([]);
  }

  const pending = create.isPending || update.isPending;
  const canSave = name.trim().length > 0 && !pending;

  function submit(allowDuplicate = false) {
    if (!canSave) return;
    if (editing) {
      // Status is deliberately absent — archiving and restoring are their own
      // permissioned actions, not a field on this form.
      update.mutate(
        { id: contractor!.id, patch: { name: name.trim(), phone: phone.trim() || null } },
        { onSuccess: () => onOpenChange(false) },
      );
      return;
    }
    const opening = openingPaise ?? undefined;
    create.mutate(
      { name: name.trim(), phone: phone.trim() || null, openingAdvancePaise: opening, allowDuplicate },
      {
        onSuccess: (res) => {
          // Nothing was created: the server is asking whether this really is a
          // different contractor.
          if ("duplicates" in res) {
            setDuplicates(res.duplicates);
            return;
          }
          onOpenChange(false);
        },
      },
    );
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
          {!editing && (
            <Field label="Opening advance" hint="Optional — an advance already paid before using the app.">
              <MoneyInput
                value={openingPaise}
                onValueChange={setOpeningPaise}
                placeholder="0"
              />
            </Field>
          )}
          {editing && (
            <p className="text-xs text-foreground-subtle">
              Archiving and restoring are separate actions on the contractor&rsquo;s page — a
              lifecycle change carries its own permission and its own audit entry, so it never
              rides along inside a detail edit.
            </p>
          )}

          {duplicates.length > 0 && (
            <div className="space-y-2 rounded-lg border border-warning/40 bg-warning-subtle/50 px-3 py-2.5 text-xs text-warning-foreground">
              <p className="font-medium">{describeDuplicates(duplicates)}</p>
              <ul className="space-y-0.5">
                {duplicates.map((d) => (
                  <li key={d.id}>
                    {d.name}
                    {d.phone ? ` · ${d.phone}` : ""}
                    {d.status === "INACTIVE" ? " · archived" : ""}
                    {d.on === "PHONE" ? " — same mobile" : ""}
                  </li>
                ))}
              </ul>
              <p>
                Nothing has been created. If this really is a different crew, add it anyway —
                otherwise cancel and use the existing one.
              </p>
            </div>
          )}
        </div>

        <SheetFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => submit(duplicates.length > 0)}
            disabled={!canSave}
          >
            {editing ? "Save" : duplicates.length > 0 ? "Add anyway" : "Add contractor"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
