"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompanyBranding, useUpdateCompanyProfile } from "../hooks";
import type { CompanyProfileInput } from "../types";

function Field({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder={placeholder} type={type} />
    </div>
  );
}

export function CompanySection({ isOwner }: { isOwner: boolean }) {
  const { data: company, isLoading } = useCompanyBranding();
  const update = useUpdateCompanyProfile();
  const [form, setForm] = React.useState<CompanyProfileInput>({});

  // Seed the form from the loaded record (derive-during-render).
  const [seededId, setSeededId] = React.useState<string | null>(null);
  if (company && seededId !== company.id) {
    setSeededId(company.id);
    setForm({
      name: company.name,
      legalName: company.legalName ?? "",
      gstin: company.gstin ?? "",
      pan: company.pan ?? "",
      cin: company.cin ?? "",
      addressLine: company.addressLine ?? "",
      city: company.city ?? "",
      state: company.state ?? "",
      country: company.country ?? "India",
      pincode: company.pincode ?? "",
      phone: company.phone ?? "",
      email: company.email ?? "",
      website: company.website ?? "",
    });
  }

  const set = (k: keyof CompanyProfileInput) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const disabled = !isOwner || update.isPending || isLoading;

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!isOwner) return;
        update.mutate(form);
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>Company information</CardTitle>
          <CardDescription>Legal and tax identity used across the app and on documents.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name" value={form.name ?? ""} onChange={set("name")} disabled={disabled} />
          <Field label="Legal company name" value={form.legalName ?? ""} onChange={set("legalName")} disabled={disabled} />
          <Field label="GST number" value={form.gstin ?? ""} onChange={set("gstin")} disabled={disabled} placeholder="29ABCDE1234F1Z5" />
          <Field label="PAN number" value={form.pan ?? ""} onChange={set("pan")} disabled={disabled} />
          <Field label="CIN (optional)" value={form.cin ?? ""} onChange={set("cin")} disabled={disabled} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contact details</CardTitle>
          <CardDescription>Address and contact info shown on PDFs and reports.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Address" value={form.addressLine ?? ""} onChange={set("addressLine")} disabled={disabled} />
          </div>
          <Field label="City" value={form.city ?? ""} onChange={set("city")} disabled={disabled} />
          <Field label="State" value={form.state ?? ""} onChange={set("state")} disabled={disabled} />
          <Field label="Country" value={form.country ?? ""} onChange={set("country")} disabled={disabled} />
          <Field label="Pincode" value={form.pincode ?? ""} onChange={set("pincode")} disabled={disabled} />
          <Field label="Phone number" value={form.phone ?? ""} onChange={set("phone")} disabled={disabled} />
          <Field label="Email" value={form.email ?? ""} onChange={set("email")} disabled={disabled} type="email" />
          <div className="sm:col-span-2">
            <Field label="Website" value={form.website ?? ""} onChange={set("website")} disabled={disabled} placeholder="https://…" />
          </div>
        </CardContent>
      </Card>

      {isOwner && (
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={disabled}>
            Save changes
          </Button>
        </div>
      )}
      {!isOwner && (
        <p className="text-xs text-foreground-subtle">Only the owner can edit company details.</p>
      )}
    </form>
  );
}
