"use client";

import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle } from "lucide-react";
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
import { laborerFormSchema, laborerFormToInput, type LaborerFormValues } from "../schema";
import { TRADES } from "../constants";
import { laborApi } from "../data";
import { useContractors, useLaborerMutations } from "../hooks";
import type { DuplicateWarning } from "../types";

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-danger-foreground">{error}</p>}
    </div>
  );
}

export function AddLaborerSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { create } = useLaborerMutations();
  const { data: contractors = [] } = useContractors();
  const [dupes, setDupes] = React.useState<DuplicateWarning[]>([]);

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors },
  } = useForm<LaborerFormValues>({
    resolver: zodResolver(laborerFormSchema),
    defaultValues: { trade: "Helper", dailyWageRupees: 500, contractorId: "" },
  });

  // react-hook-form's watch isn't memoizable by React Compiler — expected.
  // eslint-disable-next-line react-hooks/incompatible-library
  const name = watch("fullName");
  const phone = watch("phone");

  // Debounced duplicate detection (side-effect calling the repo — intentional).
  React.useEffect(() => {
    if (!name || name.trim().length < 2) {
      setDupes([]);
      return;
    }
    const t = setTimeout(() => {
      laborApi.findDuplicateLaborers(name, phone || null).then(setDupes);
    }, 400);
    return () => clearTimeout(t);
  }, [name, phone]);

  function close() {
    reset();
    setDupes([]);
    onOpenChange(false);
  }

  const onSubmit = handleSubmit(async (values) => {
    const parsed = laborerFormSchema.parse(values);
    await create.mutateAsync(laborerFormToInput(parsed));
    close();
  });

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Add worker</SheetTitle>
          <SheetDescription>Add a laborer to your roster.</SheetDescription>
        </SheetHeader>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <Field label="Full name" error={errors.fullName?.message}>
              <Input placeholder="Ramesh Kumar" autoFocus {...register("fullName")} />
            </Field>

            {dupes.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-subtle/50 px-3 py-2 text-xs text-warning-foreground">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  A worker {dupes[0].reason === "phone" ? "with this phone" : `named ${dupes[0].fullName}`}{" "}
                  already exists. You can still add this one if it&apos;s a different person.
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Field label="Trade" error={errors.trade?.message}>
                <Controller
                  control={control}
                  name="trade"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TRADES.map((t) => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field label="Daily wage (₹)" error={errors.dailyWageRupees?.message}>
                <Input type="number" min={1} step={50} {...register("dailyWageRupees")} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Phone (optional)" error={errors.phone?.message}>
                <Input placeholder="+91 98450 12345" {...register("phone")} />
              </Field>
              <Field label="Contractor (optional)">
                <Controller
                  control={control}
                  name="contractorId"
                  render={({ field }) => (
                    <Select value={field.value || "NONE"} onValueChange={(v) => field.onChange(v === "NONE" ? "" : v)}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="Direct" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">Direct (no contractor)</SelectItem>
                        {contractors
                          .filter((c) => c.status === "ACTIVE")
                          .map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </div>

            <Field label="Notes (optional)" error={errors.notes?.message}>
              <Input placeholder="Skilled in tiling" {...register("notes")} />
            </Field>
          </div>

          <SheetFooter>
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={create.isPending}>
              {create.isPending ? "Adding…" : "Add worker"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
