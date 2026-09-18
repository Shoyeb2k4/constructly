"use client";

import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { vendorFormSchema, vendorFormToInput, type VendorFormValues } from "../schema";
import { useVendorMutations } from "../hooks";
import type { Vendor, VendorStatus } from "../types";
import { VendorMaterialsField } from "./vendor-materials-field";
import { UnlinkedMaterialNames } from "./material-ref-chip";

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-danger-foreground">{error}</p>}
    </div>
  );
}

/** What an empty Add form holds. Explicit, so `reset()` returns here rather than
 *  to whatever the last vendor left behind — this sheet stays mounted between
 *  uses on the Vendors page. */
const EMPTY: VendorFormValues = {
  businessName: "",
  contactPerson: "",
  phone: "",
  email: "",
  gstin: "",
  pan: "",
  address: "",
  materialIds: [],
  paymentTerms: "",
  notes: "",
};

/**
 * Add a vendor, or edit one when `vendor` is supplied. Mount with a key tied to
 * the vendor id so the form re-seeds its defaults for each edit.
 */
export function AddVendorSheet({
  open,
  onOpenChange,
  vendor,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vendor?: Vendor;
}) {
  const { create, update } = useVendorMutations();
  const isEdit = !!vendor;
  const [status, setStatus] = React.useState<VendorStatus>(vendor?.status ?? "ACTIVE");

  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<VendorFormValues>({
    resolver: zodResolver(vendorFormSchema),
    defaultValues: vendor
      ? {
          businessName: vendor.businessName,
          contactPerson: vendor.contactPerson ?? "",
          phone: vendor.phone ?? "",
          email: vendor.email ?? "",
          gstin: vendor.gstin ?? "",
          pan: vendor.pan ?? "",
          address: vendor.address ?? "",
          // Canonical mappings — archived ones included, so saving an unrelated
          // change keeps them rather than silently dropping them.
          materialIds: vendor.materials.map((m) => m.id),
          paymentTerms: vendor.paymentTerms ?? "",
          notes: vendor.notes ?? "",
        }
      : EMPTY,
  });

  function close() {
    reset();
    setStatus(vendor?.status ?? "ACTIVE");
    onOpenChange(false);
  }

  const onSubmit = handleSubmit(async (values) => {
    const input = vendorFormToInput(vendorFormSchema.parse(values));
    try {
      if (vendor) {
        // Status only travels when it CHANGED. The server treats any status in
        // the patch as a lifecycle action needing vendors.archive/restore, so
        // always sending it would make every edit by someone who can edit but
        // not archive (a Purchase Manager) fail — for a status they never touched.
        const patch = status !== vendor.status ? { ...input, status } : input;
        await update.mutateAsync({ id: vendor.id, patch });
      } else {
        await create.mutateAsync(input);
      }
    } catch {
      // The mutation hook has already shown why. Leave the sheet open with
      // everything the user entered — including their material selection.
      return;
    }
    close();
  });

  const pending = isEdit ? update.isPending : create.isPending;

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit vendor" : "Add vendor"}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Update this supplier's details."
              : "A supplier you raise purchase orders with."}
          </SheetDescription>
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
            <div className="grid grid-cols-2 gap-4">
              <Field label="PAN" error={errors.pan?.message}>
                <Input placeholder="AAACL1234M" className="font-mono uppercase" {...register("pan")} />
              </Field>
              <Field label="Address" error={errors.address?.message}>
                <Input placeholder="Peenya, Bengaluru" {...register("address")} />
              </Field>
            </div>
            <div className="space-y-1.5">
              <Label id="vendor-materials-label">Materials supplied</Label>
              <p className="text-xs text-foreground-subtle">
                Which materials does this vendor normally supply?
              </p>
              <Controller
                control={control}
                name="materialIds"
                render={({ field }) => (
                  <VendorMaterialsField
                    value={field.value ?? []}
                    onChange={field.onChange}
                    existing={vendor?.materials}
                  />
                )}
              />
              {/* Kept on save (the server carries them forward); shown so they
                  are visible rather than silently preserved. */}
              <UnlinkedMaterialNames names={vendor?.unlinkedMaterialNames ?? []} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Payment terms" error={errors.paymentTerms?.message}>
                <Input placeholder="30 days" {...register("paymentTerms")} />
              </Field>
              {isEdit && (
                <Field label="Status">
                  <Select value={status} onValueChange={(v) => setStatus(v as VendorStatus)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACTIVE">Active</SelectItem>
                      <SelectItem value="INACTIVE">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </div>
            <Field label="Notes" error={errors.notes?.message}>
              <Input placeholder="Preferred for bulk cement" {...register("notes")} />
            </Field>
          </div>
          <SheetFooter>
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? (isEdit ? "Saving…" : "Adding…") : isEdit ? "Save changes" : "Add vendor"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
