"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/patterns/field";
import { Input } from "@/components/ui/input";
import { useCompanyBranding, useUpdateCompanyProfile } from "../hooks";
import type { CompanyProfileInput } from "../types";

function CompanyField({
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
  // Delegates the label/control association to the shared Field, which is what
  // this helper was missing: the Label had no htmlFor and the Input no id, so
  // all eleven Settings fields were unlabelled to a screen reader.
  return (
    <Field label={label}>
      <Input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder={placeholder} type={type} />
    </Field>
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
          <CompanyField label="Company name" value={form.name ?? ""} onChange={set("name")} disabled={disabled} />
          <CompanyField label="Legal company name" value={form.legalName ?? ""} onChange={set("legalName")} disabled={disabled} />
          <CompanyField label="GST number" value={form.gstin ?? ""} onChange={set("gstin")} disabled={disabled} placeholder="29ABCDE1234F1Z5" />
          <CompanyField label="PAN number" value={form.pan ?? ""} onChange={set("pan")} disabled={disabled} />
          <CompanyField label="CIN (optional)" value={form.cin ?? ""} onChange={set("cin")} disabled={disabled} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contact details</CardTitle>
          <CardDescription>Address and contact info shown on PDFs and reports.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <CompanyField label="Address" value={form.addressLine ?? ""} onChange={set("addressLine")} disabled={disabled} />
          </div>
          <CompanyField label="City" value={form.city ?? ""} onChange={set("city")} disabled={disabled} />
          <CompanyField label="State" value={form.state ?? ""} onChange={set("state")} disabled={disabled} />
          <CompanyField label="Country" value={form.country ?? ""} onChange={set("country")} disabled={disabled} />
          <CompanyField label="Pincode" value={form.pincode ?? ""} onChange={set("pincode")} disabled={disabled} />
          <CompanyField label="Phone number" value={form.phone ?? ""} onChange={set("phone")} disabled={disabled} />
          <CompanyField label="Email" value={form.email ?? ""} onChange={set("email")} disabled={disabled} type="email" />
          <div className="sm:col-span-2">
            <CompanyField label="Website" value={form.website ?? ""} onChange={set("website")} disabled={disabled} placeholder="https://…" />
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
