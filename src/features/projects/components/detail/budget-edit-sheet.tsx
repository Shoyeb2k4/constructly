"use client";

import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { RupeeInput } from "@/components/patterns/money-input";
import { zodResolver } from "@hookform/resolvers/zod";
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
    control,
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
      <Field label="Total project budget" error={errors.budgetRupees?.message}>
        <Controller
          control={control}
          name="budgetRupees"
          render={({ field }) => (
            <RupeeInput
              value={field.value as number | undefined}
              onValueChange={field.onChange}
              onBlur={field.onBlur}
              autoFocus
            />
          )}
        />
      </Field>
      <Field label="Contract value" error={errors.contractValueRupees?.message}>
        <Controller
          control={control}
          name="contractValueRupees"
          render={({ field }) => (
            <RupeeInput
              value={field.value as number | undefined}
              onValueChange={field.onChange}
              onBlur={field.onBlur}
            />
          )}
        />
      </Field>
      <Field
        label="Procurement budget (optional)"
        error={errors.procurementBudgetRupees?.message}
      >
        <Controller
          control={control}
          name="procurementBudgetRupees"
          render={({ field }) => (
            <RupeeInput
              value={field.value as number | undefined}
              onValueChange={field.onChange}
              onBlur={field.onBlur}
              placeholder="Leave blank to unset"
            />
          )}
        />
      </Field>
    </SectionEditSheet>
  );
}
