"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProfile, useUpdateProfile, useProfileAssetUrls } from "../hooks";
import type { ProfileInput } from "../types";
import { AssetUploader } from "./asset-uploader";

/**
 * Personal details, photo and signature. Theme / language / timezone and
 * password are added in Phase 5.
 */
export function ProfileSection() {
  const { data: profile, isLoading } = useProfile();
  const { data: assets } = useProfileAssetUrls();
  const update = useUpdateProfile();
  const [form, setForm] = React.useState<ProfileInput>({});

  const [seededId, setSeededId] = React.useState<string | null>(null);
  if (profile && seededId !== profile.id) {
    setSeededId(profile.id);
    setForm({
      fullName: profile.fullName,
      designation: profile.designation ?? "",
      phone: profile.phone ?? "",
    });
  }
  const set = (k: keyof ProfileInput) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const disabled = update.isPending || isLoading;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile photo</CardTitle>
          <CardDescription>Shown in the app header and on your activity.</CardDescription>
        </CardHeader>
        <CardContent className="max-w-xs">
          <AssetUploader kind="photo" currentUrl={assets?.photo} label="Photo" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Personal details</CardTitle>
          <CardDescription>Your name and contact info.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Full name</Label>
            <Input value={form.fullName ?? ""} onChange={(e) => set("fullName")(e.target.value)} disabled={disabled} />
          </div>
          <div className="space-y-1.5">
            <Label>Designation</Label>
            <Input value={form.designation ?? ""} onChange={(e) => set("designation")(e.target.value)} disabled={disabled} placeholder="e.g. Project Manager" />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input value={form.phone ?? ""} onChange={(e) => set("phone")(e.target.value)} disabled={disabled} />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={profile?.email ?? ""} disabled readOnly />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Signature</CardTitle>
          <CardDescription>Used on purchase orders you approve and on reports.</CardDescription>
        </CardHeader>
        <CardContent className="max-w-sm">
          <AssetUploader kind="signature" currentUrl={assets?.signature} label="Signature image" previewBg="light" />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="button" variant="primary" disabled={disabled} onClick={() => update.mutate(form)}>
          Save profile
        </Button>
      </div>
    </div>
  );
}
