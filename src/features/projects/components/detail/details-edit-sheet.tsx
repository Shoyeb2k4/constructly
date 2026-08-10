"use client";

import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCan } from "@/features/rbac/permission-context";
import {
  detailsSectionSchema,
  detailsSectionToPatch,
  type DetailsSectionValues,
} from "../../schema";
import type { ProjectDetail } from "../../types";
import { PROJECT_TYPES, TYPE_LABEL } from "../../constants";
import { useProjectDetailActions, useProjectActions, useManagers } from "../../hooks";
import { Field } from "../field";
import { SectionEditSheet } from "./section-edit-sheet";

/** Radix Select forbids an empty-string item value, so "no manager" uses a sentinel. */
const NO_PM = "__none__";

export function DetailsEditSheet({
  project,
  open,
  onOpenChange,
}: {
  project: ProjectDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const can = useCan();
  const canAssign = can("projects.assign");
  const { update } = useProjectDetailActions(project.id);
  const { assignManager } = useProjectActions();
  const { data: managers = [] } = useManagers(canAssign);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<DetailsSectionValues>({ resolver: zodResolver(detailsSectionSchema) });

  React.useEffect(() => {
    if (open) {
      reset({
        type: project.type,
        startDate: project.startDate ?? "",
        expectedCompletionDate: project.expectedCompletionDate ?? "",
        pmId: project.pm?.id ?? "",
      });
    }
  }, [open, project, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const parsed = detailsSectionSchema.parse(values);
    try {
      await update.mutateAsync(detailsSectionToPatch(parsed));
      const nextPm = parsed.pmId || null;
      if (canAssign && nextPm !== (project.pm?.id ?? null)) {
        await assignManager.mutateAsync({ id: project.id, pmId: nextPm });
      }
      onOpenChange(false);
    } catch {
      /* the mutations surface their own error toasts — keep the panel open */
    }
  });

  return (
    <SectionEditSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit details"
      description="Project type, manager, and schedule."
      onSubmit={onSubmit}
      saving={update.isPending || assignManager.isPending}
    >
      <Field label="Type" error={errors.type?.message}>
        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </Field>

      {canAssign && (
        <Field label="Project manager" error={errors.pmId?.message}>
          <Controller
            control={control}
            name="pmId"
            render={({ field }) => (
              <Select
                value={field.value || NO_PM}
                onValueChange={(v) => field.onChange(v === NO_PM ? "" : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PM}>Unassigned</SelectItem>
                  {managers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="Start date" error={errors.startDate?.message}>
          <Input type="date" {...register("startDate")} />
        </Field>
        <Field label="Expected completion" error={errors.expectedCompletionDate?.message}>
          <Input type="date" {...register("expectedCompletionDate")} />
        </Field>
      </div>
    </SectionEditSheet>
  );
}
