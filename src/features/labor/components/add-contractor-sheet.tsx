"use client";

import { useForm } from "react-hook-form";
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
import { contractorFormSchema, type ContractorFormValues } from "../schema";
import { useContractorMutations } from "../hooks";

export function AddContractorSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { create } = useContractorMutations();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ContractorFormValues>({ resolver: zodResolver(contractorFormSchema) });

  function close() {
    reset();
    onOpenChange(false);
  }

  const onSubmit = handleSubmit(async (values) => {
    const parsed = contractorFormSchema.parse(values);
    await create.mutateAsync({ name: parsed.name, phone: parsed.phone ?? null });
    close();
  });

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Add contractor</SheetTitle>
          <SheetDescription>Labor contractors you hire crews through.</SheetDescription>
        </SheetHeader>
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 px-6 py-5">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input placeholder="Sharma & Co." autoFocus {...register("name")} />
              {errors.name && <p className="text-xs text-danger-foreground">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Phone (optional)</Label>
              <Input placeholder="+91 98450 12345" {...register("phone")} />
              {errors.phone && <p className="text-xs text-danger-foreground">{errors.phone.message}</p>}
            </div>
          </div>
          <SheetFooter>
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={create.isPending}>
              {create.isPending ? "Adding…" : "Add contractor"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
