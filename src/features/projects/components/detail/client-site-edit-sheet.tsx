"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@/components/ui/input";
import {
  clientSectionSchema,
  clientSectionToPatch,
  type ClientSectionValues,
} from "../../schema";
import type { ProjectDetail } from "../../types";
import { useProjectDetailActions } from "../../hooks";
import { Field } from "../field";
import { SectionEditSheet } from "./section-edit-sheet";

export function ClientSiteEditSheet({
  project,
  open,
  onOpenChange,
}: {
  project: ProjectDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { update } = useProjectDetailActions(project.id);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ClientSectionValues>({ resolver: zodResolver(clientSectionSchema) });

  React.useEffect(() => {
    if (open) {
      reset({
        clientName: project.clientName ?? "",
        clientContact: project.clientContact ?? "",
        clientPhone: project.clientPhone ?? "",
        clientEmail: project.clientEmail ?? "",
        siteAddress: project.siteAddress ?? "",
      });
    }
  }, [open, project, reset]);

  const onSubmit = handleSubmit((values) => {
    const patch = clientSectionToPatch(clientSectionSchema.parse(values));
    update.mutate(patch, { onSuccess: () => onOpenChange(false) });
  });

  return (
    <SectionEditSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit client & site"
      description="Who the project is for and where it's being built."
      onSubmit={onSubmit}
      saving={update.isPending}
    >
      <Field label="Client name" error={errors.clientName?.message}>
        <Input placeholder="Nirvana Developers" autoFocus {...register("clientName")} />
      </Field>
      <Field label="Contact person" error={errors.clientContact?.message}>
        <Input placeholder="Yasho J." {...register("clientContact")} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Phone" error={errors.clientPhone?.message}>
          <Input placeholder="+91 98450 12345" {...register("clientPhone")} />
        </Field>
        <Field label="Email" error={errors.clientEmail?.message}>
          <Input type="email" placeholder="name@company.com" {...register("clientEmail")} />
        </Field>
      </div>
      <Field label="Site address" error={errors.siteAddress?.message}>
        <Input placeholder="Whitefield, Bengaluru" {...register("siteAddress")} />
      </Field>
    </SectionEditSheet>
  );
}
