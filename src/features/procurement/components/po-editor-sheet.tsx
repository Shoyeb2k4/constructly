"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { RupeeInput } from "@/components/patterns/money-input";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
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
import { MoneyText } from "@/components/patterns/money-text";
import { cn } from "@/lib/utils";
import { toPaise } from "@/lib/money";
import { formatPaiseCompact } from "@/lib/money";
import { useProjects } from "@/features/projects/hooks";
import { useProjectSpend } from "@/features/budget/hooks";
import { deriveBudget } from "@/features/budget/calc";
import { poFormSchema, poFormToInput, poDetailToForm, type POFormValues } from "../schema";
import { UNITS } from "../constants";
import { poTotals } from "../calc";
import { useVendors, usePOMutations, useMaterialCategories } from "../hooks";
import { pushRecentVendor } from "../recently-vendors";
import { getApprovalRequired } from "@/features/settings/demo-settings";
import type { PurchaseOrderDetail } from "../types";

// GST defaults to 0% — users set the applicable rate per line when needed.
const EMPTY_LINE = { material: "", category: "", quantity: 1, unit: "nos", rateRupees: 0, gstPercent: 0 };
const NO_CATEGORY = "__none__";

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

export function POEditorSheet({
  open,
  onOpenChange,
  defaultProjectId,
  editPo,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultProjectId?: string;
  /** When set, the sheet edits this PO instead of creating a new one. */
  editPo?: PurchaseOrderDetail | null;
}) {
  const router = useRouter();
  const { create, update } = usePOMutations();
  const { data: projects = [] } = useProjects({});
  const { data: vendors = [] } = useVendors({ status: "ACTIVE" });
  const { data: categories = [] } = useMaterialCategories();
  const isEdit = !!editPo;

  const createDefaults = React.useMemo<POFormValues>(
    () => ({
      projectId: defaultProjectId ?? "",
      vendorId: "",
      purchaseDate: new Date().toISOString().slice(0, 10),
      lineItems: [{ ...EMPTY_LINE }],
    }),
    [defaultProjectId],
  );

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<POFormValues>({
    resolver: zodResolver(poFormSchema),
    defaultValues: createDefaults,
  });
  const { fields, append, remove, move } = useFieldArray({ control, name: "lineItems" });

  // Load the target's values when the sheet opens (fresh defaults for create).
  const sessionKey = open ? (editPo?.id ?? "new") : "closed";
  React.useEffect(() => {
    if (!open) return;
    reset(editPo ? poDetailToForm(editPo) : createDefaults);
    // Only re-seed when the open target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  // RHF's watch() isn't memoizable by React Compiler — expected for live totals.
  // eslint-disable-next-line react-hooks/incompatible-library
  const lines = watch("lineItems");
  const projectId = watch("projectId");
  const vendorId = watch("vendorId");

  const totals = poTotals(
    (lines ?? []).map((l) => ({
      quantity: num(l.quantity),
      ratePaise: toPaise(num(l.rateRupees)),
      gstRateBps: Math.round(num(l.gstPercent) * 100),
    })),
  );
  const totalPaise = totals.totalPaise;

  const project = projects.find((p) => p.id === projectId);
  const { data: spend } = useProjectSpend(projectId || "none");
  const impact =
    project && spend
      ? deriveBudget(project.budgetPaise, {
          laborPaise: spend.laborPaise,
          procurementPaise: spend.procurementPaise + totalPaise,
        })
      : undefined;

  function close() {
    reset();
    onOpenChange(false);
  }

  const busy = create.isPending || update.isPending;

  const onSubmit = handleSubmit(async (values) => {
    const parsed = poFormSchema.parse(values);
    const input = poFormToInput(parsed);
    const po = isEdit
      ? await update.mutateAsync({ id: editPo!.id, input })
      : await create.mutateAsync(input);
    const v = vendors.find((x) => x.id === parsed.vendorId);
    if (v) pushRecentVendor({ id: v.id, name: v.businessName });
    close();
    router.push(`/procurement/${po.id}`);
  });

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <SheetContent className="sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{isEdit ? `Edit ${editPo!.poNumber}` : "New purchase order"}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Totals recalculate on save; budgets and reports update automatically."
              : getApprovalRequired()
                ? "Saved as a draft — submit for approval next."
                : "Approval is off — this PO is final on save."}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Purchase date</Label>
                <Input type="date" {...register("purchaseDate")} />
              </div>
              <div className="space-y-1.5">
                <Label>Expected delivery</Label>
                <Input type="date" {...register("expectedDelivery")} />
              </div>
              <div className="space-y-1.5">
                <Label>Invoice # (optional)</Label>
                <Input placeholder="INV-2045" {...register("invoiceNumber")} />
              </div>
            </div>

            {/* Line items */}
            <div className="space-y-2">
              <Label>Line items</Label>
              <div className="rounded-lg border border-border">
                <div className="hidden grid-cols-[1fr_110px_64px_74px_84px_64px_88px_76px] gap-2 border-b border-border px-3 py-2 text-xs text-foreground-subtle sm:grid">
                  <span>Material</span><span>Category</span><span>Qty</span><span>Unit</span><span>Rate ₹</span><span>GST %</span><span className="text-right">Amount</span><span />
                </div>
                {fields.map((f, i) => (
                  <div key={f.id} className="grid grid-cols-2 items-center gap-2 border-b border-border px-3 py-2 last:border-0 sm:grid-cols-[1fr_110px_64px_74px_84px_64px_88px_76px]">
                    <Input className="h-8" placeholder="OPC Cement" {...register(`lineItems.${i}.material`)} />
                    <Controller
                      control={control}
                      name={`lineItems.${i}.category`}
                      render={({ field }) => (
                        <Select
                          value={field.value || NO_CATEGORY}
                          onValueChange={(v) => field.onChange(v === NO_CATEGORY ? "" : v)}
                        >
                          <SelectTrigger className="h-8 px-2 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_CATEGORY}>—</SelectItem>
                            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <Input className="h-8 px-2" type="number" step="0.01" min={0} {...register(`lineItems.${i}.quantity`)} />
                    <Controller
                      control={control}
                      name={`lineItems.${i}.unit`}
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className="h-8 px-2"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <Controller
                      control={control}
                      name={`lineItems.${i}.rateRupees`}
                      render={({ field }) => (
                        <RupeeInput
                          className="h-8 px-2"
                          value={field.value as number | undefined}
                          onValueChange={field.onChange}
                          onBlur={field.onBlur}
                          aria-label="Rate per unit"
                        />
                      )}
                    />
                    <Input
                      className="h-8 px-2"
                      type="number"
                      step="0.01"
                      min={0}
                      max={100}
                      list="gst-presets"
                      {...register(`lineItems.${i}.gstPercent`)}
                    />
                    <span className="text-right font-mono text-xs tabular-nums text-foreground-muted">
                      {formatPaiseCompact(toPaise(num(lines?.[i]?.quantity) * num(lines?.[i]?.rateRupees)))}
                    </span>
                    <div className="col-span-2 flex items-center justify-end gap-0.5 sm:col-span-1">
                      <button
                        type="button"
                        onClick={() => i > 0 && move(i, i - 1)}
                        className="flex size-6 items-center justify-center rounded-md text-foreground-subtle hover:bg-surface-muted disabled:opacity-30"
                        disabled={i === 0}
                        aria-label="Move line up"
                      >
                        <ChevronUp className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => i < fields.length - 1 && move(i, i + 1)}
                        className="flex size-6 items-center justify-center rounded-md text-foreground-subtle hover:bg-surface-muted disabled:opacity-30"
                        disabled={i === fields.length - 1}
                        aria-label="Move line down"
                      >
                        <ChevronDown className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => fields.length > 1 && remove(i)}
                        className="flex size-6 items-center justify-center rounded-md text-foreground-subtle hover:bg-surface-muted disabled:opacity-30"
                        disabled={fields.length === 1}
                        aria-label="Remove line"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                {/* Standard GST slabs as quick suggestions; free entry allowed. */}
                <datalist id="gst-presets">
                  <option value="0" /><option value="5" /><option value="12" /><option value="18" /><option value="28" />
                </datalist>
              </div>
              <button
                type="button"
                onClick={() => append({ ...EMPTY_LINE })}
                className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <Plus className="size-4" /> Add line item
              </button>
              {errors.lineItems && typeof errors.lineItems.message === "string" && (
                <p className="text-xs text-danger-foreground">{errors.lineItems.message}</p>
              )}
            </div>

            <div className="space-y-1.5 border-t border-border pt-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground-muted">Subtotal</span>
                <span className="font-mono tabular-nums"><MoneyText paise={totals.subtotalPaise} whole /></span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground-muted">GST</span>
                <span className="font-mono tabular-nums"><MoneyText paise={totals.gstPaise} whole /></span>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-sm font-medium">Grand total</span>
                <span className="text-lg font-semibold"><MoneyText paise={totals.totalPaise} whole /></span>
              </div>
            </div>

            {impact && project && project.budgetPaise > 0 && (
              <div
                className={cn(
                  "rounded-lg border px-3 py-2 text-xs",
                  impact.overBudget
                    ? "border-warning/40 bg-warning-subtle/50 text-warning-foreground"
                    : "border-border bg-surface-muted/40 text-foreground-muted",
                )}
              >
                {impact.overBudget ? "⚠ " : ""}
                This puts {project.name} at <strong>{impact.utilizationPct}%</strong> of budget
                {impact.overBudget ? " — allowed, but over budget." : "."}
              </div>
            )}
          </div>

          <SheetFooter>
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy || !vendorId || !projectId}>
              {busy
                ? isEdit ? "Saving…" : "Creating…"
                : isEdit ? "Save changes" : "Create purchase order"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
