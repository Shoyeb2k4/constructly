"use client";

import * as React from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
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
import { cn } from "@/lib/utils";
import { MoneyInput } from "@/components/patterns/money-input";
import { useContractorProfile } from "@/features/contracts/hooks";
import { scopedAdvanceBlockedReason } from "@/features/contracts/agreement-actions";
import { useRecordAdvance } from "../hooks";

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * What the money is earmarked for. Business words, not the allocator's:
 * "strict-to-broad", "scope tier" and "bucket" are how the engine thinks, not
 * how a site office does.
 */
type ScopeChoice = "GENERAL" | "PROJECT" | "AGREEMENT";

const CHOICES: { value: ScopeChoice; label: string }[] = [
  { value: "GENERAL", label: "General contractor" },
  { value: "PROJECT", label: "Specific project" },
  { value: "AGREEMENT", label: "Specific agreement" },
];

/**
 * Record a labour advance, and say what it is FOR.
 *
 * The ledger and the allocator have always supported scope — an advance carries
 * an optional project and agreement, and `allocateAdvanceDrawdown` spends the
 * narrowest money first and refuses to spend an agreement's money on another
 * agreement's labour. Until now the sheet sent neither field, so every advance
 * was recorded as company-wide and that whole machinery could never be exercised
 * by a user.
 *
 * The options offered here are deliberately narrower than what the schema would
 * technically accept: only projects and agreements this contractor is actually
 * on, only agreements that can still spend the money, and only what the caller
 * is allowed to see — the list comes from `useContractorProfile`, which the
 * server already scopes with the same `projectScope` filter it applies to
 * agreements. The server re-validates all of it regardless; a select control is
 * a convenience, never a permission check.
 */
export function RecordAdvanceSheet({
  open,
  onOpenChange,
  contractorId,
  contractorName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contractorId: string;
  contractorName: string;
}) {
  const record = useRecordAdvance();
  const { data: profile } = useContractorProfile(contractorId);

  const [date, setDate] = React.useState(todayISO());
  // Null until something is entered, so "not filled in" stays distinct from ₹0.
  const [amountPaiseRaw, setAmountPaise] = React.useState<number | null>(null);
  const [notes, setNotes] = React.useState("");
  const [scope, setScope] = React.useState<ScopeChoice>("GENERAL");
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [contractId, setContractId] = React.useState<string | null>(null);

  const [key, setKey] = React.useState(false);
  if (key !== open) {
    setKey(open);
    if (open) {
      setDate(todayISO());
      setAmountPaise(null);
      setNotes("");
      setScope("GENERAL");
      setProjectId(null);
      setContractId(null);
    }
  }

  /**
   * Projects this contractor is actually on — those with an agreement, plus
   * those with only attendance. The second half matters: an attendance-only
   * project is exactly where a project-scoped advance is most useful, and
   * keying off agreements alone would hide it.
   */
  const projects = React.useMemo(() => {
    const byId = new Map<string, string>();
    for (const g of profile?.projects ?? []) byId.set(g.projectId, g.projectName);
    for (const a of profile?.attendance ?? []) byId.set(a.projectId, a.projectName);
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [profile]);

  /**
   * Agreements that can still SPEND earmarked money. A cancelled or settled
   * agreement takes no further attendance, so an advance scoped to one would be
   * stranded the moment it was recorded — the server refuses it, and offering it
   * here would only produce an error the user could have been spared.
   */
  const agreements = React.useMemo(
    () =>
      (profile?.projects ?? []).flatMap((g) =>
        g.contracts
          .filter((c) => scopedAdvanceBlockedReason(c.status) == null)
          .map((c) => ({
            id: c.id,
            title: c.title,
            projectId: g.projectId,
            projectName: g.projectName,
          })),
      ),
    [profile],
  );

  const chosenProject = projects.find((p) => p.id === projectId) ?? null;
  const chosenAgreement = agreements.find((a) => a.id === contractId) ?? null;

  // Integer paise throughout — MoneyInput never hands back a string.
  const amountPaise = amountPaiseRaw ?? 0;
  const scopeReady =
    scope === "GENERAL" ||
    (scope === "PROJECT" && !!chosenProject) ||
    (scope === "AGREEMENT" && !!chosenAgreement);
  const canSave = amountPaise > 0 && scopeReady && !record.isPending;

  /** Exactly the fields the server expects — derived, never guessed. */
  function scopeFields(): { projectId: string | null; contractId: string | null } {
    if (scope === "PROJECT" && chosenProject) {
      return { projectId: chosenProject.id, contractId: null };
    }
    if (scope === "AGREEMENT" && chosenAgreement) {
      // Selecting the agreement DERIVES its project — the two can never be
      // set to a contradictory pair, which the schema would reject anyway.
      return { projectId: chosenAgreement.projectId, contractId: chosenAgreement.id };
    }
    return { projectId: null, contractId: null };
  }

  function submit() {
    if (!canSave) return;
    record.mutate(
      {
        contractorId,
        date,
        amountPaise,
        notes: notes.trim() || null,
        ...scopeFields(),
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Record advance</SheetTitle>
          <SheetDescription>An advance paid to {contractorName}.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="space-y-1.5">
            <Label htmlFor="advance-date">Date</Label>
            <Input
              id="advance-date"
              type="date"
              value={date}
              max={todayISO()}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="advance-amount">Amount</Label>
            <MoneyInput
              id="advance-amount"
              // The RAW value, not the `?? 0` used for arithmetic below: an
              // empty field must read as empty and show its placeholder, not
              // as a zero the user has to delete before typing.
              value={amountPaiseRaw}
              onValueChange={setAmountPaise}
              placeholder="1,00,000"
              autoFocus
            />
          </div>

          {/* ── Scope ────────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label>Apply this advance to</Label>
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
            <div className="space-y-1.5">
              <Label>Project</Label>
              <Select value={projectId ?? undefined} onValueChange={setProjectId}>
                <SelectTrigger aria-label="Project for this advance">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {projects.length === 0 && (
                <p className="text-xs text-foreground-subtle">
                  This contractor isn&rsquo;t on any project you can see yet.
                </p>
              )}
            </div>
          )}

          {scope === "AGREEMENT" && (
            <div className="space-y-1.5">
              <Label>Agreement</Label>
              <Select value={contractId ?? undefined} onValueChange={setContractId}>
                <SelectTrigger aria-label="Agreement for this advance">
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
              {agreements.length === 0 && (
                <p className="text-xs text-foreground-subtle">
                  No agreement can take earmarked money right now — a cancelled or settled
                  agreement can&rsquo;t spend it.
                </p>
              )}
            </div>
          )}

          {/* ── What that actually means ─────────────────────────────── */}
          {amountPaise > 0 && scopeReady && (
            <p className="rounded-lg border border-border bg-surface-muted/40 px-3 py-2.5 text-xs text-foreground-muted">
              <MoneyText paise={amountPaise} className="font-medium text-foreground" />{" "}
              {scope === "GENERAL" && (
                <>
                  will be available broadly to {contractorName}&rsquo;s eligible work across their
                  projects and agreements.
                </>
              )}
              {scope === "PROJECT" && (
                <>
                  will be available only for eligible work on{" "}
                  <strong className="font-medium text-foreground">{chosenProject!.name}</strong>.
                </>
              )}
              {scope === "AGREEMENT" && (
                <>
                  will be available only for{" "}
                  <strong className="font-medium text-foreground">
                    {chosenAgreement!.projectName} → {chosenAgreement!.title}
                  </strong>
                  . It won&rsquo;t be drawn on by another agreement, another project, or labour
                  that isn&rsquo;t attributed to an agreement.
                </>
              )}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="advance-notes">Notes</Label>
            <Input
              id="advance-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>

        <SheetFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSave}>
            Record advance
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
