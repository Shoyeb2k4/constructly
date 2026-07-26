"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Monitor, Moon, Sun } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useProfile, useUpdateProfile, useProfileAssetUrls } from "../hooks";
import { updateProfile } from "../server/actions";
import { AssetUploader } from "./asset-uploader";

const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Dhaka",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी (Hindi)" },
  { code: "mr", label: "मराठी (Marathi)" },
  { code: "gu", label: "ગુજરાતી (Gujarati)" },
  { code: "ta", label: "தமிழ் (Tamil)" },
];

interface DetailsForm {
  fullName: string;
  designation: string;
  phone: string;
  language: string;
  timezone: string;
}
const EMPTY: DetailsForm = { fullName: "", designation: "", phone: "", language: "en", timezone: "Asia/Kolkata" };

export function ProfileSection() {
  const { data: profile, isLoading } = useProfile();
  const { data: assets } = useProfileAssetUrls();
  const update = useUpdateProfile();
  const { theme, setTheme } = useTheme();

  const [form, setForm] = React.useState<DetailsForm>(EMPTY);
  const [baseline, setBaseline] = React.useState<DetailsForm>(EMPTY);
  const [seededId, setSeededId] = React.useState<string | null>(null);
  if (profile && seededId !== profile.id) {
    setSeededId(profile.id);
    const seed: DetailsForm = {
      fullName: profile.fullName,
      designation: profile.designation ?? "",
      phone: profile.phone ?? "",
      language: profile.language ?? "en",
      timezone: profile.timezone ?? "Asia/Kolkata",
    };
    setForm(seed);
    setBaseline(seed);
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const nameError = form.fullName.trim().length === 0;

  // Warn before leaving with unsaved changes.
  React.useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const set = (k: keyof DetailsForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function save() {
    if (nameError) return;
    update.mutate(form, { onSuccess: () => setBaseline(form) });
  }
  function cancel() {
    setForm(baseline);
  }

  // Theme is applied live and persisted quietly (not part of the dirty form).
  function changeTheme(value: string) {
    setTheme(value);
    void updateProfile({ theme: value }).catch(() => {});
  }
  const currentTheme = theme ?? "system";

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
          <CardDescription>Your name, role, and contact info.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="p-name">Full name</Label>
              <Input
                id="p-name"
                value={form.fullName}
                onChange={(e) => set("fullName")(e.target.value)}
                disabled={update.isPending || isLoading}
                aria-invalid={nameError}
              />
              {nameError && <p className="text-xs text-danger-foreground">Name is required.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-designation">Designation</Label>
              <Input
                id="p-designation"
                value={form.designation}
                onChange={(e) => set("designation")(e.target.value)}
                disabled={update.isPending || isLoading}
                placeholder="e.g. Project Manager"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-phone">Phone</Label>
              <Input
                id="p-phone"
                value={form.phone}
                onChange={(e) => set("phone")(e.target.value)}
                disabled={update.isPending || isLoading}
                inputMode="tel"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-email">Email</Label>
              <Input id="p-email" value={profile?.email ?? ""} disabled readOnly />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Language</Label>
              <Select value={form.language} onValueChange={set("language")}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-foreground-subtle">Interface translation is coming soon.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Timezone</Label>
              <Select value={form.timezone} onValueChange={set("timezone")}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>{tz.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Appearance / theme (applied live) */}
      <Card>
        <CardHeader>
          <CardTitle>Theme</CardTitle>
          <CardDescription>Applies immediately on this device and is remembered for your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-2">
            {[
              { value: "light", label: "Light", icon: Sun },
              { value: "dark", label: "Dark", icon: Moon },
              { value: "system", label: "System", icon: Monitor },
            ].map((opt) => {
              const Icon = opt.icon;
              const active = currentTheme === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => changeTheme(opt.value)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-foreground-muted hover:bg-surface-muted",
                  )}
                >
                  <Icon className="size-4" />
                  {opt.label}
                </button>
              );
            })}
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

      <ChangePasswordCard />
      <SessionsCard />

      {/* Sticky save bar for the details form */}
      {dirty && (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
          <span className="text-sm text-foreground-muted">You have unsaved changes.</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={cancel} disabled={update.isPending}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={save} disabled={update.isPending || nameError}>
              Save changes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChangePasswordCard() {
  const [pw, setPw] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const tooShort = pw.length > 0 && pw.length < 8;
  const mismatch = confirm.length > 0 && pw !== confirm;
  const canSave = pw.length >= 8 && pw === confirm && !busy;

  async function submit() {
    if (!canSave) return;
    const { isSupabaseConfigured } = await import("@/lib/env");
    if (!isSupabaseConfigured) {
      toast("Password change needs Supabase", { description: "Not available in demo mode." });
      return;
    }
    setBusy(true);
    const { createClient } = await import("@/lib/supabase/client");
    const { error } = await createClient().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) {
      toast.error("Couldn't update password", { description: error.message });
      return;
    }
    setPw("");
    setConfirm("");
    toast.success("Password updated");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>Use at least 8 characters.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:max-w-md">
        <div className="space-y-1.5">
          <Label htmlFor="pw-new">New password</Label>
          <Input id="pw-new" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          {tooShort && <p className="text-xs text-danger-foreground">Must be at least 8 characters.</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw-confirm">Confirm password</Label>
          <Input id="pw-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          {mismatch && <p className="text-xs text-danger-foreground">Passwords don&apos;t match.</p>}
        </div>
        <div>
          <Button variant="primary" onClick={submit} disabled={!canSave}>
            Update password
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const [busy, setBusy] = React.useState(false);

  async function signOutOthers() {
    const { isSupabaseConfigured } = await import("@/lib/env");
    if (!isSupabaseConfigured) {
      toast("Sessions need Supabase", { description: "Not available in demo mode." });
      return;
    }
    setBusy(true);
    const { createClient } = await import("@/lib/supabase/client");
    const { error } = await createClient().auth.signOut({ scope: "others" });
    setBusy(false);
    if (error) {
      toast.error("Couldn't sign out other devices", { description: error.message });
      return;
    }
    toast.success("Signed out other devices");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>Manage where you&apos;re signed in.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-foreground-muted">
          Sign out everywhere except this device. A detailed per-device list isn&apos;t available with the
          current setup.
        </p>
        <Button variant="secondary" onClick={signOutOthers} disabled={busy}>
          Sign out other devices
        </Button>
      </CardContent>
    </Card>
  );
}
