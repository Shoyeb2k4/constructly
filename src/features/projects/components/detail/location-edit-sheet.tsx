"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@/components/ui/input";
import {
  locationSectionSchema,
  locationSectionToPatch,
  type LocationSectionValues,
} from "../../schema";
import { useProjectDetailActions } from "../../hooks";
import { Field } from "../field";
import { SectionEditSheet } from "./section-edit-sheet";

export function LocationEditSheet({
  projectId,
  gpsLat,
  gpsLng,
  open,
  onOpenChange,
}: {
  projectId: string;
  gpsLat: number | null;
  gpsLng: number | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { update } = useProjectDetailActions(projectId);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<LocationSectionValues>({ resolver: zodResolver(locationSectionSchema) });

  React.useEffect(() => {
    if (open) {
      reset({
        gpsLat: gpsLat ?? "",
        gpsLng: gpsLng ?? "",
      });
    }
  }, [open, gpsLat, gpsLng, reset]);

  const onSubmit = handleSubmit((values) => {
    const patch = locationSectionToPatch(locationSectionSchema.parse(values));
    update.mutate(patch, { onSuccess: () => onOpenChange(false) });
  });

  return (
    <SectionEditSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit location"
      description="Site GPS coordinates. Leave both blank to clear."
      onSubmit={onSubmit}
      saving={update.isPending}
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Latitude" error={errors.gpsLat?.message}>
          <Input type="number" step="any" placeholder="12.9716" autoFocus {...register("gpsLat")} />
        </Field>
        <Field label="Longitude" error={errors.gpsLng?.message}>
          <Input type="number" step="any" placeholder="77.5946" {...register("gpsLng")} />
        </Field>
      </div>
      <p className="text-xs text-foreground-subtle">
        Tip: in Google Maps, right-click the site and copy the latitude, longitude.
      </p>
    </SectionEditSheet>
  );
}
