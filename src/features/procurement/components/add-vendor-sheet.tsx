"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
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
import { vendorFormSchema, vendorFormToInput, type VendorFormValues } from "../schema";
import { useVendorMutations } from "../hooks";

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-danger-foreground">{error}</p>}
    </div>
  );
}

export function AddVendorSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { create } = useVendorMutations();
  const [materials, setMaterials] = React.useState<string[]>([]);
  const [draft, setDraft] = React.useState("");

  const { register, handleSubmit, reset, formState: { errors } } = useForm<VendorFormValues>({
    resolver: zodResolver(vendorFormSchema),
  });

  function close() {
    reset();
    setMaterials([]);
    setDraft("");
    onOpenChange(false);
  }
  function addMaterial() {
    const m = draft.trim();
    if (m && !materials.includes(m)) setMaterials([...materials, m]);
    setDraft("");
  }

  const onSubmit = handleSubmit(async (values) => {
    const parsed = vendorFormSchema.parse({ ...values, materialsSupplied: materials });
    await create.mutateAsync(vendorFormToInput(parsed));
    close();
  });

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Add vendor</SheetTitle>
          <SheetDescription>A supplier you raise purchase orders with.</SheetDescription>
        </SheetHeader>
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <Field label="Business name" error={errors.businessName?.message}>
              <Input placeholder="UltraTech Cement" autoFocus {...register("businessName")} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Contact person" error={errors.contactPerson?.message}>
                <Input placeholder="Rajesh Iyer" {...register("contactPerson")} />
              </Field>
              <Field label="Phone" error={errors.phone?.message}>
                <Input placeholder="+91 98450 11001" {...register("phone")} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Email" error={errors.email?.message}>
                <Input placeholder="sales@vendor.com" {...register("email")} />
              </Field>
              <Field label="GSTIN" error={errors.gstin?.message}>
                <Input placeholder="29AAACL1234M1Z5" className="font-mono" {...register("gstin")} />
              </Field>
            </div>
            <Field label="Address" error={errors.address?.message}>
              <Input placeholder="Peenya, Bengaluru" {...register("address")} />
            </Field>
            <Field label="Materials supplied">
              <div className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius)] border border-border-strong bg-surface px-2 py-1.5">
                {materials.map((m) => (
                  <span key={m} className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground-muted">
                    {m}
                    <button type="button" onClick={() => setMaterials(materials.filter((x) => x !== m))} className="text-foreground-subtle hover:text-foreground"><X className="size-3" /></button>
                  </span>
                ))}
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addMaterial(); } }}
                  onBlur={addMaterial}
                  placeholder={materials.length ? "" : "Cement, Steel…"}
                  className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-foreground-subtle"
                />
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Payment terms" error={errors.paymentTerms?.message}>
                <Input placeholder="30 days" {...register("paymentTerms")} />
              </Field>
            </div>
            <Field label="Notes" error={errors.notes?.message}>
              <Input placeholder="Preferred for bulk cement" {...register("notes")} />
            </Field>
          </div>
          <SheetFooter>
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={create.isPending}>
              {create.isPending ? "Adding…" : "Add vendor"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
