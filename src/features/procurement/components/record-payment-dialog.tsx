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
import { Field } from "@/components/patterns/field";
import { MoneyInput } from "@/components/patterns/money-input";
import { Callout } from "@/components/patterns/callout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPaiseCompact, toPaise, toRupees } from "@/lib/money";
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

  // One idempotency key per dialog-open session: reused across retries (network
  // failure, double-click), so the server dedups instead of double-recording.
  // A fresh key is minted on the next open — the dialog remounts via key="open".
  const clientUuidRef = React.useRef("");
  if (!clientUuidRef.current) clientUuidRef.current = crypto.randomUUID();

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
    await create.mutateAsync({ ...paymentFormToInput(parsed), clientUuid: clientUuidRef.current });
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
            <Field label="Vendor" error={errors.vendorId?.message}>
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
            </Field>
            <Field label="Project" error={errors.projectId?.message}>
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
            </Field>
          </div>

          <Field label="Purchase order" hint="Leave as on-account for an advance not tied to an order.">
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
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Amount" required error={errors.amountRupees?.message}>
              {/* The form still speaks RUPEES, because the schema coerces and
                  converts. MoneyInput speaks paise, so the two are bridged here
                  rather than by changing what the schema means. */}
              <Controller
                control={control}
                name="amountRupees"
                render={({ field }) => (
                  <MoneyInput
                    placeholder="50,000"
                    value={
                      typeof field.value === "number" && Number.isFinite(field.value)
                        ? toPaise(field.value)
                        : null
                    }
                    onValueChange={(paise) =>
                      field.onChange(paise == null ? undefined : toRupees(paise))
                    }
                    onBlur={field.onBlur}
                  />
                )}
              />
            </Field>
            <Field label="Mode">
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
            </Field>
            <Field label="Date">
              <Input type="date" {...register("date")} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Reference #" hint="UTR, cheque or UPI reference.">
              <Input placeholder="UTR / cheque / UPI ref" {...register("referenceNumber")} />
            </Field>
            <Field label="Remarks">
              <Input placeholder="Part payment for steel" {...register("remarks")} />
            </Field>
          </div>

          {softWarn && (
            <Callout tone="attention" title="More than the outstanding amount">
              This exceeds the {selectedPO ? `outstanding on ${selectedPO.poNumber}` : "vendor's outstanding"}.
              That is allowed — paying an advance is normal — so this is a prompt to double-check
              the figure, not a refusal.
            </Callout>
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
