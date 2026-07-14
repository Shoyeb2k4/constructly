"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, FolderKanban, Wallet, CalendarClock, HardHat } from "lucide-react";
import { Logo } from "@/components/shell/logo";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatCard } from "@/components/patterns/stat-card";
import { MoneyText } from "@/components/patterns/money-text";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { RowsSkeleton } from "@/components/patterns/loading-state";
import {
  StatusBadge,
  PROJECT_STAGE_META,
  ATTENDANCE_META,
  PO_STATUS_META,
} from "@/components/patterns/status-badge";
import { toPaise } from "@/lib/money";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="text-sm text-foreground-muted">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <div className="space-y-1.5">
      <div className={`h-14 rounded-lg border border-border ${className}`} />
      <span className="font-mono text-xs text-foreground-muted">{name}</span>
    </div>
  );
}

export default function StyleGuidePage() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Logo />
          <Badge variant="primary">Design system</Badge>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="secondary" size="sm">
            <Link href="/dashboard">
              <ArrowLeft className="size-4" />
              Back to app
            </Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-14 px-6 py-12">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Blueprint design system
          </h1>
          <p className="max-w-2xl text-foreground-muted">
            The visual foundation for Constructly — tokens, primitives, and
            patterns. Everything below adapts to light and dark automatically.
          </p>
        </div>

        <Section title="Color" description="Semantic tokens, light + dark aware.">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Swatch name="primary" className="bg-primary" />
            <Swatch name="success" className="bg-success" />
            <Swatch name="warning" className="bg-warning" />
            <Swatch name="danger" className="bg-danger" />
            <Swatch name="surface" className="bg-surface" />
            <Swatch name="surface-muted" className="bg-surface-muted" />
          </div>
        </Section>

        <Section title="Typography" description="Inter for UI, JetBrains Mono for figures.">
          <div className="space-y-2 rounded-xl border border-border bg-surface p-6">
            <p className="text-3xl font-semibold tracking-tight">Display / 3xl semibold</p>
            <p className="text-2xl font-semibold tracking-tight">Heading / 2xl semibold</p>
            <p className="text-base">Body / base regular — the default reading size.</p>
            <p className="text-sm text-foreground-muted">Small / muted secondary text.</p>
            <p className="font-mono text-sm tabular-nums">PRJ-0142 · <MoneyText paise={toPaise(1_20_00_000)} /></p>
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
            <Button disabled>Disabled</Button>
          </div>
        </Section>

        <Section title="Badges & status" description="Domain statuses map to tones.">
          <div className="flex flex-wrap gap-2">
            <Badge>Neutral</Badge>
            <Badge variant="primary">Primary</Badge>
            <Badge variant="success">Success</Badge>
            <Badge variant="warning">Warning</Badge>
            <Badge variant="danger">Danger</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge meta={PROJECT_STAGE_META} value="CONSTRUCTION" />
            <StatusBadge meta={PROJECT_STAGE_META} value="QUALITY_INSPECTION" />
            <StatusBadge meta={ATTENDANCE_META} value="PRESENT" />
            <StatusBadge meta={ATTENDANCE_META} value="HALF_DAY" />
            <StatusBadge meta={ATTENDANCE_META} value="ABSENT" />
            <StatusBadge meta={PO_STATUS_META} value="APPROVED" />
          </div>
        </Section>

        <Section title="Form controls">
          <div className="grid max-w-md gap-4 rounded-xl border border-border bg-surface p-6">
            <div className="space-y-1.5">
              <Label htmlFor="demo-name">Project name</Label>
              <Input id="demo-name" placeholder="Skyline Residency" />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="demo-switch">Require PO approval</Label>
              <Switch id="demo-switch" defaultChecked />
            </div>
          </div>
        </Section>

        <Section title="Stat cards" description="Executive KPIs.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Active projects" value="6" icon={FolderKanban} hint="2 nearing deadline" />
            <StatCard label="Deadlines" value="3" icon={CalendarClock} tone="warning" hint="Next in 12 days" />
            <StatCard label="Today's labor" value="42" icon={HardHat} hint="Across 4 sites" />
            <StatCard label="Budget" value={<MoneyText paise={toPaise(4_20_00_000)} compact />} icon={Wallet} hint="of ₹5.2Cr" />
          </div>
        </Section>

        <Section title="States" description="Empty, loading, and error — every view ships all three.">
          <div className="grid gap-6 lg:grid-cols-2">
            <EmptyState
              icon={FolderKanban}
              title="No projects yet"
              description="Create your first project to get started."
              action={<Button variant="primary" size="sm">Create project</Button>}
            />
            <ErrorState onRetry={() => {}} />
          </div>
          <RowsSkeleton rows={3} />
        </Section>

        <Section title="Overlays">
          <div className="flex flex-wrap items-center gap-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary">Open dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete project?</DialogTitle>
                  <DialogDescription>
                    This cannot be undone. All associated data will be removed.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost">Cancel</Button>
                  <Button variant="danger">Delete</Button>
                </div>
              </DialogContent>
            </Dialog>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline">Hover for tooltip</Button>
              </TooltipTrigger>
              <TooltipContent>Press ⌘K to search</TooltipContent>
            </Tooltip>
          </div>
        </Section>

        <Separator />
        <p className="pb-8 text-center text-sm text-foreground-subtle">
          Constructly · Blueprint design system · Module 0
        </p>
      </div>
    </div>
  );
}
