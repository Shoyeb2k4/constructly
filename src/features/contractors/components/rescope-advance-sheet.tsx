"use client";

/**
 * Move UNUSED advance money to a different scope.
 *
 * Pass 8 let a user say what an advance was for; until now that answer was
 * permanent. Money recorded against the wrong agreement — or stranded on one
 * that was later cancelled — had no way back.
 *
 * The sheet is built around one claim, stated rather than implied: **no cash
 * moves**. A reader watching ₹2,00,000 shift between columns deserves to be told
 * that the contractor was not paid again, no settlement ran, and nothing
 * historical changed. Every figure comes from the server's canonical preview;
 * nothing is summed here.
 */

import * as React from "react";
import { Info } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyText } from "@/components/patterns/money-text";
import { Callout } from "@/components/patterns/callout";
import { cn } from "@/lib/utils";
import { MoneyInput } from "@/components/patterns/money-input";
import { useContractorProfile } from "@/features/contracts/hooks";
import { scopedAdvanceBlockedReason } from "@/features/contracts/agreement-actions";
import { useAdvanceRescopePreview, useRescopeAdvance } from "../hooks";
import { describeRescopeBlocker, describeRescopeWarning } from "../advance-rescope";
import type { ContractorLedgerEntry } from "../types";

type ScopeChoice = "GENERAL" | "PROJECT" | "AGREEMENT";

const CHOICES: { value: ScopeChoice; label: string }[] = [
  { value: "GENERAL", label: "General contractor" },
  { value: "PROJECT", label: "Specific project" },
  { value: "AGREEMENT", label: "Specific agreement" },
];

const REASONS = [
  "Advance recorded against wrong agreement",
  "Agreement cancelled",
  "Agreement closed with unused advance",
  "Commercial allocation corrected",
  "Project allocation corrected",
];

export function RescopeAdvanceSheet({
  open,
  onOpenChange,
  contractorId,
  contractorName,
  advance,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contractorId: string;
  contractorName: string;
  /** The ledger row being re-scoped. */
  advance: ContractorLedgerEntry;
}) {
  const { data: profile } = useContractorProfile(contractorId);
  const rescope = useRescopeAdvance();

  const [scope, setScope] = React.useState<ScopeChoice>("GENERAL");
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [contractId, setContractId] = React.useState<string | null>(null);
  const [amountPaise, setAmountPaise] = React.useState<number | null>(null);
  const [reason, setReason] = React.useState("");

  const [wasOpen, setWasOpen] = React.useState(false);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setScope("GENERAL");
      setProjectId(null);
      setContractId(null);
      setAmountPaise(null);
      setReason("");
    }
  }

  const projects = React.useMemo(() => {
    const byId = new Map<string, string>();
    for (const g of profile?.projects ?? []) byId.set(g.projectId, g.projectName);
    for (const a of profile?.attendance ?? []) byId.set(a.projectId, a.projectName);
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [profile]);

  // Agreements that can actually hold earmarked money — the same rule Pass 8
  // applies when an advance is first recorded, so the two never disagree.
  const agreements = React.useMemo(
    () =>
      (profile?.projects ?? []).flatMap((g) =>
        g.contracts
          .filter((c) => scopedAdvanceBlockedReason(c.status) == null)
          .map((c) => ({ id: c.id, title: c.title, projectId: g.projectId, projectName: g.projectName })),
      ),
    [profile],
  );

  const chosenAgreement = agreements.find((a) => a.id === contractId) ?? null;
  const target =
    scope === "AGREEMENT" && chosenAgreement
      ? { projectId: chosenAgreement.projectId, contractId: chosenAgreement.id }
      : scope === "PROJECT" && projectId
        ? { projectId, contractId: null }
        : { projectId: null, contractId: null };

  const transferPaise = amountPaise ?? 0;
  const preview = useAdvanceRescopePreview({
    contractorId,
    advanceId: open ? advance.id : null,
    target,
    transferPaise,
  });
  // A full preview carries its own `blockers`, so narrow on a preview-only key.
  const p = preview.data && "source" in preview.data ? preview.data : null;
  const blockers = p ? p.blockers : (preview.data?.blockers ?? []);

  const scopeReady =
    scope === "GENERAL" ||
    (scope === "PROJECT" && !!projectId) ||
    (scope === "AGREEMENT" && !!chosenAgreement);
  const canSave =
    transferPaise > 0 && scopeReady && reason.trim().length > 0 && blockers.length === 0 && !rescope.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Re-scope advance</SheetTitle>
          <SheetDescription>{contractorName} — move unused advance money.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <p className="text-xs text-foreground-subtle">
            This changes which work the money is available to. It is not a payment: the contractor
            isn&rsquo;t paid again, no settlement runs, and everything already recorded stays as it is.
          </p>

          {/* ── The source ───────────────────────────────────────────── */}
          {p && (
            <div className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm">
              <p className="text-xs uppercase tracking-wide text-foreground-subtle">
                This advance
              </p>
              <p className="mt-0.5 font-medium">{p.source.scopeLabel}</p>
              <div className="mt-1.5 space-y-0.5 text-xs text-foreground-muted">
                <Line label="Original" paise={p.source.originalPaise} />
                {p.source.consumedPaise > 0 && (
                  <Line label="Used by settlements" paise={p.source.consumedPaise} />
                )}
                {p.source.transferredOutPaise > 0 && (
                  <Line label="Already re-scoped" paise={p.source.transferredOutPaise} />
                )}
                <Line label="Unused" paise={p.source.remainingPaise} strong />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rescope-amount">Amount to move</Label>
            <MoneyInput
              id="rescope-amount"
              value={amountPaise}
              onValueChange={setAmountPaise}
              placeholder="2,00,000"
              autoFocus
            />
            <p className="text-xs text-foreground-subtle">
              Only money no settlement has used can be moved.
            </p>
          </div>

          {/* ── The target ───────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label>Move it to</Label>
            <div className="flex flex-wrap gap-1.5">
              {CHOICES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  aria-pressed={scope === c.value}
                  onClick={() => {
                    setScope(c.value);
                    setProjectId(null);
                    setContractId(null);
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs transition-colors",
                    scope === c.value
                      ? "border-primary bg-primary-subtle font-medium text-primary-emphasis"
                      : "border-border text-foreground-muted hover:bg-surface-muted",
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {scope === "PROJECT" && (
            <Select value={projectId ?? undefined} onValueChange={setProjectId}>
              <SelectTrigger aria-label="Target project">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((pr) => (
                  <SelectItem key={pr.id} value={pr.id}>
                    {pr.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {scope === "AGREEMENT" && (
            <Select value={contractId ?? undefined} onValueChange={setContractId}>
              <SelectTrigger aria-label="Target agreement">
                <SelectValue placeholder="Select agreement" />
              </SelectTrigger>
              <SelectContent>
                {agreements.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.projectName} → {a.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rescope-reason">Reason</Label>
            <Input
              id="rescope-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this money moving?"
            />
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className="rounded-full border border-border px-2.5 py-1 text-xs text-foreground-muted transition-colors hover:bg-surface-muted"
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {blockers.map((code) => (
            <Callout key={code} tone="blocked">
              {describeRescopeBlocker(code)}
            </Callout>
          ))}

          {/* ── What it does ─────────────────────────────────────────── */}
          {p && p.blockers.length === 0 && (
            <div className="space-y-2 rounded-lg border border-border bg-surface-muted/40 px-3 py-2.5 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs uppercase tracking-wide text-foreground-subtle">Moving</span>
                <span className="font-mono font-medium">
                  <MoneyText paise={p.transferPaise} />
                </span>
              </div>
              <p className="text-xs text-foreground-muted">
                From <strong className="font-medium">{p.source.scopeLabel}</strong> to{" "}
                <strong className="font-medium text-foreground">{p.target.label}</strong>.
              </p>

              <div className="space-y-1 border-t border-border pt-2 text-xs">
                <Change
                  label={`${p.source.scopeLabel} available`}
                  before={p.before.sourceAvailablePaise}
                  after={p.after.sourceAvailablePaise}
                />
                <Change
                  label={`${p.target.label} available`}
                  before={p.before.targetAvailablePaise}
                  after={p.after.targetAvailablePaise}
                />
                <Change
                  label="Total advance balance"
                  before={p.before.contractorBalancePaise}
                  after={p.after.contractorBalancePaise}
                />
              </div>

              <p className="flex items-start gap-1.5 border-t border-border pt-2 text-xs text-foreground-subtle">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                Cash impact <strong className="font-medium text-foreground">₹0</strong> · historical
                settlements unchanged · the original advance stays on the ledger.
              </p>

              {p.warnings.map((w) => (
                <Callout key={w} tone="attention">
                  {describeRescopeWarning(w, p.source.scopeLabel)}
                </Callout>
              ))}
            </div>
          )}
        </div>

        <SheetFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={() =>
              rescope.mutate(
                {
                  contractorId,
                  advanceId: advance.id,
                  target,
                  transferPaise,
                  reason: reason.trim(),
                },
                {
                  onSuccess: (res) => {
                    if (!("blockers" in res)) onOpenChange(false);
                  },
                },
              )
            }
          >
            {rescope.isPending ? "Moving…" : "Re-scope advance"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Line({ label, paise, strong }: { label: string; paise: number; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span>{label}</span>
      <MoneyText paise={paise} className={cn("font-mono", strong && "font-medium text-foreground")} />
    </div>
  );
}

function Change({ label, before, after }: { label: string; before: number; after: number }) {
  const moved = before !== after;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="truncate text-foreground-subtle">{label}</span>
      <span className={cn("shrink-0 font-mono", moved ? "text-foreground" : "text-foreground-subtle")}>
        <MoneyText paise={before} /> <span className="text-foreground-subtle">→</span>{" "}
        <span className={cn(moved && "font-medium")}>
          <MoneyText paise={after} />
        </span>
      </span>
    </div>
  );
}
