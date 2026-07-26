"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompanyBranding, useBrandingAssetUrls, useUpdateBrandColors } from "../hooks";
import { effectiveBrandColors } from "../assets";
import { CONSTRUCTLY_BRAND_COLORS } from "../constants";
import type { BrandColors } from "../types";
import { AssetUploader } from "./asset-uploader";

const COLOR_KEYS: { key: keyof BrandColors; label: string }[] = [
  { key: "primary", label: "Primary" },
  { key: "secondary", label: "Secondary" },
  { key: "accent", label: "Accent" },
  { key: "success", label: "Success" },
  { key: "warning", label: "Warning" },
  { key: "danger", label: "Danger" },
];

function ColorField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="size-9 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5 disabled:cursor-not-allowed"
          aria-label={`${label} color`}
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="font-mono" />
      </div>
    </div>
  );
}

export function AppearanceSection({ isOwner }: { isOwner: boolean }) {
  const { data: company } = useCompanyBranding();
  const { data: urls } = useBrandingAssetUrls();
  const update = useUpdateBrandColors();

  const [colors, setColors] = React.useState<Required<BrandColors>>(CONSTRUCTLY_BRAND_COLORS);
  const [seededId, setSeededId] = React.useState<string | null>(null);
  if (company && seededId !== company.id) {
    setSeededId(company.id);
    setColors(effectiveBrandColors(company.brandColors));
  }
  const set = (k: keyof BrandColors) => (v: string) => setColors((c) => ({ ...c, [k]: v }));
  const disabled = !isOwner || update.isPending;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Logo</CardTitle>
          <CardDescription>
            Shown in the sidebar, on the dashboard, and on PDFs. Falls back to Constructly when unset.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <AssetUploader kind="logo" currentUrl={urls?.logo} label="Primary logo" />
          <AssetUploader kind="squareLogo" currentUrl={urls?.squareLogo} label="Square logo (app icon)" />
          <AssetUploader kind="lightLogo" currentUrl={urls?.lightLogo} label="Light logo (for dark backgrounds)" previewBg="dark" />
          <AssetUploader kind="darkLogo" currentUrl={urls?.darkLogo} label="Dark logo (for light backgrounds)" previewBg="light" />
          <AssetUploader kind="favicon" currentUrl={urls?.favicon} label="Favicon" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Brand colors</CardTitle>
          <CardDescription>Custom theme colors, previewed live below before you save.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {COLOR_KEYS.map(({ key, label }) => (
              <ColorField key={key} label={label} value={colors[key]} onChange={set(key)} disabled={disabled} />
            ))}
          </div>

          {/* Live preview */}
          <div
            className="space-y-3 rounded-xl border border-border p-4"
            style={
              {
                "--primary": colors.primary,
                "--success": colors.success,
                "--warning": colors.warning,
                "--danger": colors.danger,
              } as React.CSSProperties
            }
          >
            <p className="text-xs font-medium text-foreground-subtle">Preview</p>
            <div className="flex flex-wrap items-center gap-2">
              {COLOR_KEYS.map(({ key, label }) => (
                <div key={key} className="flex items-center gap-1.5">
                  <span className="size-5 rounded-md border border-border" style={{ background: colors[key] }} />
                  <span className="text-xs text-foreground-muted">{label}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-lg px-3 py-1.5 text-sm font-medium text-white" style={{ background: colors.primary }}>
                Primary button
              </button>
              <span className="rounded-full px-2.5 py-1 text-xs font-medium text-white" style={{ background: colors.success }}>Success</span>
              <span className="rounded-full px-2.5 py-1 text-xs font-medium text-white" style={{ background: colors.warning }}>Warning</span>
              <span className="rounded-full px-2.5 py-1 text-xs font-medium text-white" style={{ background: colors.danger }}>Danger</span>
            </div>
          </div>

          {isOwner ? (
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={disabled}
                onClick={() => setColors(CONSTRUCTLY_BRAND_COLORS)}
              >
                Reset to Constructly
              </Button>
              <Button type="button" variant="primary" disabled={disabled} onClick={() => update.mutate(colors)}>
                Save colors
              </Button>
            </div>
          ) : (
            <p className="text-xs text-foreground-subtle">Only the owner can change brand colors.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
