"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@/components/ui/input";
import { toRupees } from "@/lib/money";
import {
  budgetSectionSchema,
  budgetSectionToPatch,
  type BudgetSectionValues,
} from "../../schema";
import { useProjectDetailActions } from "../../hooks";
import { Field } from "../field";
import { SectionEditSheet } from "./section-edit-sheet";

export function BudgetEditSheet({
  projectId,
  budgetPaise,
  contractValuePaise,
  procurementBudgetPaise,
  open,
  onOpenChange,
}: {
  projectId: string;
  budgetPaise: number;
  contractValuePaise: number;
  procurementBudgetPaise: number | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { update } = useProjectDetailActions(projectId);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<BudgetSectionValues>({ resolver: zodResolver(budgetSectionSchema) });

  // Seed the form from the current values whenever the panel opens.
  React.useEffect(() => {
    if (open) {
      reset({
        budgetRupees: toRupees(budgetPaise),
        contractValueRupees: toRupees(contractValuePaise),
        procurementBudgetRupees:
          procurementBudgetPaise != null ? toRupees(procurementBudgetPaise) : undefined,
      });
    }
  }, [open, budgetPaise, contractValuePaise, procurementBudgetPaise, reset]);

  const onSubmit = handleSubmit((values) => {
    const patch = budgetSectionToPatch(budgetSectionSchema.parse(values));
    update.mutate(patch, { onSuccess: () => onOpenChange(false) });
  });

  return (
    <SectionEditSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit budget"
      description="Overall project budget, contract value, and a dedicated procurement budget."
      onSubmit={onSubmit}
      saving={update.isPending}
    >
      <Field label="Total project budget (₹)" error={errors.budgetRupees?.message}>
        <Input type="number" min={0} step={1000} autoFocus {...register("budgetRupees")} />
      </Field>
      <Field label="Contract value (₹)" error={errors.contractValueRupees?.message}>
        <Input type="number" min={0} step={1000} {...register("contractValueRupees")} />
      </Field>
      <Field
        label="Procurement budget (₹, optional)"
        error={errors.procurementBudgetRupees?.message}
      >
        <Input
          type="number"
          min={0}
          step={1000}
          placeholder="Leave blank to unset"
          {...register("procurementBudgetRupees")}
        />
      </Field>
    </SectionEditSheet>
  );
}
