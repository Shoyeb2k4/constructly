"use client";

import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { formatPaiseCompact, toPaise } from "@/lib/money";
import { useProjects } from "@/features/projects/hooks";
import { paymentFormSchema, paymentFormToInput, type PaymentFormValues } from "../schema";
import { PAYMENT_MODE_LABEL, PAYMENT_MODES } from "../constants";
import { usePaymentMutations, usePurchaseOrders, useVendors } from "../hooks";

const NO_PO = "__none__";

export function RecordPaymentDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultVendorId?: string;
  defaultProjectId?: string;
  defaultPurchaseOrderId?: string;
}) {
  // Key-remount so defaults re-apply cleanly every time it opens.
  return props.open ? <PaymentDialogInner key="open" {...props} /> : null;
}

function PaymentDialogInner({
  open,
  onOpenChange,
  defaultVendorId,
  defaultProjectId,
  defaultPurchaseOrderId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultVendorId?: string;
  defaultProjectId?: string;
  defaultPurchaseOrderId?: string;
}) {
  const { create } = usePaymentMutations();
  const { data: vendors = [] } = useVendors({});
  const { data: projects = [] } = useProjects({});

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentFormSchema),
    defaultValues: {
      vendorId: defaultVendorId ?? "",
      projectId: defaultProjectId ?? "",
      purchaseOrderId: defaultPurchaseOrderId ?? "",
      amountRupees: undefined as unknown as number,
      paymentMode: "BANK_TRANSFER",
      date: new Date().toISOString().slice(0, 10),
    },
  });

  // RHF's watch() isn't memoizable by React Compiler — expected for live UI.
  // eslint-disable-next-line react-hooks/incompatible-library
  const vendorId = watch("vendorId");
  const projectId = watch("projectId");
  const poId = watch("purchaseOrderId");
  const amountRupees = watch("amountRupees");

  const { data: vendorPOs = [] } = usePurchaseOrders(
    vendorId && projectId ? { vendorId, projectId } : { vendorId: vendorId || "ALL" },
  );
  const selectablePOs = vendorPOs.filter((p) => p.status !== "DRAFT");
  const selectedPO = selectablePOs.find((p) => p.id === poId);
  const vendor = vendors.find((v) => v.id === vendorId);

  const amountPaise = toPaise(Number(amountRupees) || 0);
  const poOutstanding = selectedPO ? selectedPO.totalPaise - selectedPO.paidPaise : null;
  const softWarn =
    amountPaise > 0 &&
    (poOutstanding != null
      ? amountPaise > poOutstanding
      : vendor != null && vendor.outstandingPaise >= 0 && amountPaise > vendor.outstandingPaise);

  const onSubmit = handleSubmit(async (values) => {
    const parsed = paymentFormSchema.parse({
      ...values,
      purchaseOrderId: values.purchaseOrderId === NO_PO ? "" : values.purchaseOrderId,
    });
    await create.mutateAsync(paymentFormToInput(parsed));
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            Payments are project-aware. Link a purchase order, or leave it blank for an
            advance / on-account payment.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Vendor</Label>
              <Controller
                control={control}
                name="vendorId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select vendor" /></SelectTrigger>
                    <SelectContent>
                      {vendors.map((v) => (
                        <SelectItem key={v.id} value={v.id}>{v.businessName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.vendorId && <p className="text-xs text-danger-foreground">{errors.vendorId.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Project</Label>
              <Controller
                control={control}
                name="projectId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select project" /></SelectTrigger>
                    <SelectContent>
                      {projects.filter((p) => !p.archivedAt).map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.projectId && <p className="text-xs text-danger-foreground">{errors.projectId.message}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Purchase order (optional)</Label>
            <Controller
              control={control}
              name="purchaseOrderId"
              render={({ field }) => (
                <Select value={field.value || NO_PO} onValueChange={(v) => field.onChange(v === NO_PO ? "" : v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PO}>No PO — advance / on-account</SelectItem>
                    {selectablePOs.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.poNumber} · {formatPaiseCompact(p.totalPaise - p.paidPaise)} due
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Amount ₹</Label>
              <Input type="number" step="0.01" min={0} placeholder="50,000" {...register("amountRupees")} />
              {errors.amountRupees && <p className="text-xs text-danger-foreground">{errors.amountRupees.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <Controller
                control={control}
                name="paymentMode"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_MODES.map((m) => (
                        <SelectItem key={m} value={m}>{PAYMENT_MODE_LABEL[m]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" {...register("date")} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Reference # (optional)</Label>
              <Input placeholder="UTR / cheque / UPI ref" {...register("referenceNumber")} />
            </div>
            <div className="space-y-1.5">
              <Label>Remarks (optional)</Label>
              <Input placeholder="Part payment for steel" {...register("remarks")} />
            </div>
          </div>

          {softWarn && (
            <div className="rounded-lg border border-warning/40 bg-warning-subtle/50 px-3 py-2 text-xs text-warning-foreground">
              ⚠ This exceeds the {selectedPO ? `outstanding on ${selectedPO.poNumber}` : "vendor's outstanding"}
              {" "}— allowed (advances are normal), just double-check the amount.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={create.isPending || !vendorId || !projectId}>
              {create.isPending ? "Recording…" : "Record payment"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
