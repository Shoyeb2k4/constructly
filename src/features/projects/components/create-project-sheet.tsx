"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { projectFormSchema, formToInput, type ProjectFormValues } from "../schema";
import { PROJECT_TYPES, TYPE_LABEL } from "../constants";
import { useCreateProject, useManagers } from "../hooks";
import type { ProjectContractorInput } from "../types";
import { Field } from "./field";
import { ContractorAssignmentsField, cleanAssignments } from "./contractor-assignments-field";

export function CreateProjectSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const create = useCreateProject();
  const { data: managers = [] } = useManagers();
  const [tags, setTags] = React.useState<string[]>([]);
  const [tagDraft, setTagDraft] = React.useState("");
  const [assignments, setAssignments] = React.useState<ProjectContractorInput[]>([]);

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors },
  } = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: { type: "RESIDENTIAL", budgetRupees: 0, contractValueRupees: 0 },
  });

  function close() {
    reset();
    setTags([]);
    setTagDraft("");
    setAssignments([]);
    onOpenChange(false);
  }

  const onSubmit = handleSubmit(async (values) => {
    const parsed = projectFormSchema.parse({ ...values, tags });
    try {
      const project = await create.mutateAsync({
        ...formToInput(parsed),
        contractors: cleanAssignments(assignments),
      });
      close();
      router.push(`/projects/${project.id}`);
    } catch (e) {
      // A duplicate code is the one expected, user-fixable failure — anchor it to
      // the Code field so the sheet stays open for a quick edit. Everything else
      // is handled by the mutation's onError toast.
      if (/DUPLICATE_CODE/i.test(e instanceof Error ? e.message : "")) {
        setError("code", { message: "This project code is already in use" });
      }
    }
  });

  function addTag() {
    const t = tagDraft.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagDraft("");
  }

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>New project</SheetTitle>
          <SheetDescription>
            Set up a project. You can fill in the rest later.
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={onSubmit}
          className="flex min-h-0 flex-1 flex-col"
          id="create-project-form"
        >
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <Field label="Project name" error={errors.name?.message}>
              <Input placeholder="Skyline Residency" autoFocus {...register("name")} />
            </Field>

            <div className="grid grid-cols-2 gap-4">
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
              <Field label="Code (optional)" error={errors.code?.message}>
                <Input placeholder="Auto: PRJ-####" className="font-mono" {...register("code")} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Budget (₹)" error={errors.budgetRupees?.message}>
                <Input type="number" min={0} step={1000} {...register("budgetRupees")} />
              </Field>
              <Field label="Contract value (₹)" error={errors.contractValueRupees?.message}>
                <Input type="number" min={0} step={1000} {...register("contractValueRupees")} />
              </Field>
            </div>

            <Field label="Procurement budget (₹, optional)" error={errors.procurementBudgetRupees?.message}>
              <Input type="number" min={0} step={1000} placeholder="Dedicated materials budget" {...register("procurementBudgetRupees")} />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Start date" error={errors.startDate?.message}>
                <Input type="date" {...register("startDate")} />
              </Field>
              <Field
                label="Expected completion"
                error={errors.expectedCompletionDate?.message}
              >
                <Input type="date" {...register("expectedCompletionDate")} />
              </Field>
            </div>

            <Field label="Project manager" error={errors.pmId?.message}>
              <Controller
                control={control}
                name="pmId"
                render={({ field }) => (
                  <Select value={field.value || ""} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
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

            <div className="space-y-3 rounded-lg border border-border bg-surface-muted/40 p-4">
              <p className="text-xs font-medium text-foreground-subtle">
                CLIENT & SITE
              </p>
              <Field label="Client name" error={errors.clientName?.message}>
                <Input placeholder="Nirvana Developers" {...register("clientName")} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Client phone" error={errors.clientPhone?.message}>
                  <Input placeholder="+91 98450 12345" {...register("clientPhone")} />
                </Field>
                <Field label="Site address" error={errors.siteAddress?.message}>
                  <Input placeholder="Whitefield, Bengaluru" {...register("siteAddress")} />
                </Field>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-border bg-surface-muted/40 p-4">
              <div>
                <p className="text-xs font-medium text-foreground-subtle">CONTRACTORS</p>
                <p className="mt-0.5 text-xs text-foreground-subtle">
                  Assign contractors to the work they handle on this project.
                </p>
              </div>
              <ContractorAssignmentsField value={assignments} onChange={setAssignments} />
            </div>

            <Field label="Tags">
              <div className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius)] border border-border-strong bg-surface px-2 py-1.5">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground-muted"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => setTags(tags.filter((x) => x !== t))}
                      className="text-foreground-subtle hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  onBlur={addTag}
                  placeholder={tags.length ? "" : "Add tags…"}
                  className="min-w-20 flex-1 bg-transparent text-sm outline-none placeholder:text-foreground-subtle"
                />
              </div>
            </Field>
          </div>

          <SheetFooter>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create project"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
