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
import { UNITS } from "../constants";
import { materialFormSchema, materialFormToInput, type MaterialFormValues } from "../schema";
import { useMaterialCategories, useMaterialMutations } from "../hooks";
import type { Material } from "../types";

/** Select needs a non-empty value, so "not set" gets its own sentinel. */
const NONE = "__none__";

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-danger-foreground">{error}</p>
      ) : hint ? (
        <p className="text-xs text-foreground-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Add a material, or edit one when `material` is supplied. Mount with a key tied
 * to the material id so the form re-seeds for each edit — the same convention
 * AddVendorSheet uses.
 */
export function MaterialSheet({
  open,
  onOpenChange,
  material,
  defaultName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  material?: Material;
  /** Prefills the name when creating — e.g. what was typed into a picker's
   *  search before "Create …" was chosen. The user still confirms it. */
  defaultName?: string;
  /** Called with the saved material, so an embedding flow can select it. */
  onSaved?: (m: Material) => void;
}) {
  const isEdit = !!material;
  const { create, update } = useMaterialMutations();
  const { data: categories = [] } = useMaterialCategories();

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<MaterialFormValues>({
    resolver: zodResolver(materialFormSchema),
    defaultValues: {
      name: material?.name ?? defaultName ?? "",
      category: material?.category ?? "",
      defaultUnit: material?.defaultUnit ?? "",
      hsnCode: material?.hsnCode ?? "",
    },
  });

  function close() {
    reset();
    onOpenChange(false);
  }

  const submit = handleSubmit(async (values) => {
    const input = materialFormToInput(materialFormSchema.parse(values));
    let saved: Material;
    try {
      saved = material
        ? await update.mutateAsync({ id: material.id, patch: input })
        : await create.mutateAsync(input);
    } catch {
      // The mutation hook has already told the user why (e.g. a duplicate
      // name). Keep the sheet open with what they typed, rather than letting
      // the rejection escape as an unhandled error.
      return;
    }
    onSaved?.(saved);
    close();
  });

  // This sheet can be opened from INSIDE another form (the vendor sheet's
  // material picker). Its content is portalled, but React still bubbles the
  // submit event up the component tree — so without this, saving a material
  // would also submit the vendor form behind it.
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.stopPropagation();
    return submit(e);
  };

  const pending = isEdit ? update.isPending : create.isPending;

  // A material whose category Settings has since dropped stays editable — the
  // server accepts its own existing value — so keep it selectable here too.
  const categoryOptions =
    material?.category && !categories.includes(material.category)
      ? [...categories, material.category]
      : categories;

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit material" : "Add material"}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Existing purchase orders keep the material name recorded when they were created."
              : "An item your company buys, e.g. OPC 53 Grade Cement."}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <Field label="Material name" error={errors.name?.message}>
              <Input placeholder="OPC 53 Grade Cement" autoFocus {...register("name")} />
            </Field>

            <Field
              label="Category"
              hint="Categories group materials. Manage them in Settings."
              error={errors.category?.message}
            >
              <Controller
                control={control}
                name="category"
                render={({ field }) => (
                  <Select
                    value={field.value || NONE}
                    onValueChange={(v) => field.onChange(v === NONE ? "" : v)}
                  >
                    <SelectTrigger className="w-full" aria-label="Category">
                      <SelectValue placeholder="No category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No category</SelectItem>
                      {categoryOptions.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Default unit" error={errors.defaultUnit?.message}>
                <Controller
                  control={control}
                  name="defaultUnit"
                  render={({ field }) => (
                    <Select
                      value={field.value || NONE}
                      onValueChange={(v) => field.onChange(v === NONE ? "" : v)}
                    >
                      <SelectTrigger className="w-full" aria-label="Default unit">
                        <SelectValue placeholder="No unit" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>No unit</SelectItem>
                        {UNITS.map((u) => (
                          <SelectItem key={u} value={u}>
                            {u}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              <Field label="HSN code (optional)" error={errors.hsnCode?.message}>
                <Input placeholder="25232910" inputMode="numeric" className="font-mono" {...register("hsnCode")} />
              </Field>
            </div>
          </div>

          <SheetFooter>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? (isEdit ? "Saving…" : "Adding…") : isEdit ? "Save changes" : "Add material"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
