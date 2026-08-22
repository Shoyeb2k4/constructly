"use client";

/**
 * The ONE place an agreed rate changes.
 *
 * Before this, a rate could only be changed as a side effect of the Scope &
 * Labour sheet, which sent `effectiveFrom: today` and the canned reason "Rate
 * updated from scope". That made the two things the domain is careful to keep
 * separate — WHICH labour types a contractor supplies, and WHAT they are paid
 * for them — impossible to tell apart in the audit trail, and made backdating
 * (the normal case: a rate agreed verbally in July, entered in August) simply
 * unreachable.
 *
 * "Revise", not "Edit", because that is what happens: `setScopeRate` APPENDS a
 * revision. The earlier rate is never overwritten, which is what lets attendance
 * recorded months ago keep valuing at the rate that applied on its own date.
 *
 * Nothing here computes a rate. Bands, the in-force revision and the same-day
 * winner all come from ../rates — the same pure engine the server uses, so the
 * preview a user reads and the row the server writes cannot disagree.
 */

import * as React from "react";
import { CalendarClock, History } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { MoneyInput } from "@/components/patterns/money-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyText } from "@/components/patterns/money-text";
import { formatDate } from "@/features/projects/format";
import { useRateRevisions, useSetScopeRate } from "../hooks";
import { effectiveRateOn, rateBands, supersedesOn, validateRateRevision } from "../rates";
import type { Contract, ScopeItem } from "../types";

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Suggested reasons, offered as one-tap chips rather than a fixed list — the
 * field stays free text because the real reason is often specific ("Revised
 * after the March site meeting"). The point is to stop the audit trail filling
 * with a canned string nobody chose.
 */
const REASONS = [
  "Annual rate revision",
  "Negotiated rate change",
  "Scope variation",
  "Correction of entered rate",
  "Revised labour agreement",
];

export function ReviseRateSheet({
  item,
  contract,
  open,
  onOpenChange,
}: {
  item: ScopeItem;
  contract: Pick<Contract, "id" | "title" | "startDate" | "projectName">;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data: revisions = [] } = useRateRevisions(item.id);
  const setRate = useSetScopeRate();

  const [ratePaiseRaw, setRatePaise] = React.useState<number | null>(null);
  const [effectiveFrom, setEffectiveFrom] = React.useState(todayISO());
  const [reason, setReason] = React.useState("");

  // Fresh sheet, fresh form — the same render-phase reset idiom the scope sheet
  // uses, rather than an effect (which lint rejects as a cascading render).
  const [wasOpen, setWasOpen] = React.useState(false);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setRatePaise(item.currentRatePaise);
      setEffectiveFrom(todayISO());
      setReason("");
    }
  }

  // Same idiom as the amendment and scope sheets: blank means "not entered yet",
  // which is different from zero (which validateRateRevision rejects by name).
  const ratePaise = ratePaiseRaw;
  const today = todayISO();

  /** The rate that applies on the proposed date TODAY — what is being replaced. */
  const replacing = effectiveRateOn(revisions, effectiveFrom);
  const currentToday = effectiveRateOn(revisions, today);
  const superseded = supersedesOn(revisions, effectiveFrom);

  const invalid = validateRateRevision({
    ratePaise: ratePaise ?? 0,
    effectiveFrom,
    agreementStartDate: contract.startDate,
  });
  // The server accepts a null reason (the opening revision written by scope
  // creation legitimately has its own provenance). The UI requires one anyway:
  // a rate change with no stated reason is exactly the entry nobody can explain
  // six months later, which is the whole point of keeping the history.
  const missingReason = reason.trim().length === 0;
  const noChange = ratePaise != null && replacing != null && ratePaise === replacing.ratePaise;
  const canSave = ratePaise != null && !invalid && !missingReason && !noChange && !setRate.isPending;

  /**
   * Bands as they WOULD read once this revision lands. Computed with the same
   * `rateBands` the Rates tab renders and the server's engine resolves, so the
   * preview cannot promise something the write does not do.
   */
  const projected =
    ratePaise == null || invalid
      ? null
      : rateBands([
          ...revisions,
          {
            id: "__proposed__",
            scopeItemId: item.id,
            ratePaise,
            rateUnit: item.rateUnit,
            effectiveFrom,
            reason: reason.trim() || null,
            createdByName: null,
            // Newest wins a same-day tie, exactly as the server will resolve it.
            createdAt: new Date(8.64e15).toISOString(),
          },
        ]);

  const proposedBand = projected?.find((b) => b.revisionId === "__proposed__");
  // The band IMMEDIATELY before the proposed one. Bands come back oldest first,
  // so the last one that ends before it starts is the one being closed off —
  // `find` would name the oldest band instead, which is the wrong rate.
  const bandBefore = projected
    ?.filter((b) => proposedBand && b.toDate != null && b.toDate < proposedBand.fromDate)
    .at(-1);
  const future = effectiveFrom > today;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Revise rate — {item.subcategoryName}</SheetTitle>
          <SheetDescription>
            {contract.title}
            {contract.projectName ? ` · ${contract.projectName}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <p className="text-xs text-foreground-subtle">
            This adds a revision — it does not overwrite the current rate. Attendance already
            recorded keeps the rate it was valued at.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="revise-rate">New rate</Label>
            <MoneyInput
              id="revise-rate"
              value={ratePaiseRaw}
              onValueChange={setRatePaise}
              // The unit belongs beside the number, never inside it — the value
              // is money and stays parseable as money.
              suffix={`per ${item.rateUnit}`}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="revise-from">Effective from</Label>
            <Input
              id="revise-from"
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
            <p className="text-xs text-foreground-subtle">
              Rates are often agreed verbally and entered later, so an earlier date is normal.
              {contract.startDate && ` Not before the agreement started (${formatDate(contract.startDate)}).`}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="revise-reason">Reason</Label>
            <Input
              id="revise-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is the rate changing?"
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

          {/* ── Preview ──────────────────────────────────────────────── */}
          {invalid ? (
            <p className="text-xs text-danger-foreground">{invalid}</p>
          ) : noChange ? (
            <p className="text-xs text-foreground-subtle">
              That is already the rate in force on {formatDate(effectiveFrom)} — nothing to revise.
            </p>
          ) : (
            ratePaise != null &&
            proposedBand && (
              <div className="space-y-2 rounded-lg border border-border bg-surface-muted/40 px-3 py-2.5 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs uppercase tracking-wide text-foreground-subtle">
                    Current
                  </span>
                  <span className="font-mono">
                    {currentToday ? (
                      <>
                        <MoneyText paise={currentToday.ratePaise} />
                        <span className="ml-1 text-xs text-foreground-subtle">
                          /{currentToday.rateUnit} from {formatDate(currentToday.effectiveFrom)}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-foreground-subtle">No rate yet</span>
                    )}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs uppercase tracking-wide text-foreground-subtle">New</span>
                  <span className="font-mono font-medium">
                    <MoneyText paise={ratePaise} />
                    <span className="ml-1 text-xs text-foreground-subtle">
                      /{item.rateUnit} from {formatDate(effectiveFrom)}
                    </span>
                  </span>
                </div>

                <p className="border-t border-border pt-2 text-xs text-foreground-muted">
                  {bandBefore ? (
                    <>
                      The existing <MoneyText paise={bandBefore.ratePaise} />/{bandBefore.rateUnit}{" "}
                      rate will apply through {formatDate(bandBefore.toDate!)}.{" "}
                      <MoneyText paise={ratePaise} />/{item.rateUnit} will apply from{" "}
                      {formatDate(proposedBand.fromDate)}
                      {proposedBand.toDate ? ` through ${formatDate(proposedBand.toDate)}` : " onward"}.
                    </>
                  ) : (
                    <>
                      <MoneyText paise={ratePaise} />/{item.rateUnit} will apply from{" "}
                      {formatDate(proposedBand.fromDate)}
                      {proposedBand.toDate ? ` through ${formatDate(proposedBand.toDate)}` : " onward"}.
                    </>
                  )}
                </p>

                {future && (
                  <p className="flex items-start gap-1.5 text-xs text-foreground-subtle">
                    <CalendarClock className="mt-0.5 size-3.5 shrink-0" />
                    Scheduled, not current. Today&rsquo;s rate stays{" "}
                    {currentToday ? <MoneyText paise={currentToday.ratePaise} /> : "unchanged"} until{" "}
                    {formatDate(effectiveFrom)}.
                  </p>
                )}

                {superseded && (
                  <p className="flex items-start gap-1.5 text-xs text-warning-foreground">
                    <History className="mt-0.5 size-3.5 shrink-0" />
                    A revision already begins on {formatDate(effectiveFrom)} (
                    <MoneyText paise={superseded.ratePaise} />). Saving another for this date will
                    supersede it as the latest revision for that day. Both stay on record.
                  </p>
                )}

                <p className="text-xs text-foreground-subtle">
                  Attendance already recorded is not repriced — every row keeps the rate it was
                  saved with.
                </p>
              </div>
            )
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
              setRate.mutate(
                {
                  scopeItemId: item.id,
                  ratePaise: ratePaise!,
                  rateUnit: item.rateUnit,
                  effectiveFrom,
                  reason: reason.trim(),
                },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            {setRate.isPending ? "Saving…" : "Save revision"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
