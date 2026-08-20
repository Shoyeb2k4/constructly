"use client";

/**
 * Assign settled labour that carries no agreement to the agreement it belongs
 * to — the answer to the question Pass 7 taught the app to ask.
 *
 * This is a governed correction, not an edit, and the sheet is built to make
 * that obvious: every figure in the preview comes from the server's canonical
 * reconciliation, the cash impact is stated as ₹0 rather than left to be
 * inferred, and a reason is required. Nothing is computed here — a preview that
 * did its own arithmetic is a preview that can disagree with the write.
 */

import * as React from "react";
import { AlertTriangle, Info } from "lucide-react";
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
import { formatDate } from "@/features/projects/format";
import { cn } from "@/lib/utils";
import {
  useAttributableLabour,
  useAttributionPreview,
  useAttributeSettledLabour,
} from "../hooks";
import {
  attributionTargetBlockedReason,
  describeBlocker,
  describeWarning,
} from "../attribution";
import type { Contract } from "../types";

const REASONS = [
  "Agreement attribution entered late",
  "Agreement created after attendance was recorded",
  "Labour belonged to this agreement",
  "Historical attendance correction",
  "Data entry correction",
];

export function AttributeLabourSheet({
  open,
  onOpenChange,
  contractorId,
  projectId,
  projectName,
  agreements,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contractorId: string;
  projectId: string;
  projectName: string;
  /** This contractor's agreements ON THIS PROJECT. Filtered again below. */
  agreements: Contract[];
}) {
  const { data: rows = [], isLoading } = useAttributableLabour(contractorId, open ? projectId : null);
  const attribute = useAttributeSettledLabour();

  const [selected, setSelected] = React.useState<string[]>([]);
  const [contractId, setContractId] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");

  const [wasOpen, setWasOpen] = React.useState(false);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setSelected([]);
      setContractId(null);
      setReason("");
    }
  }

  // Only agreements that can actually receive historical credit. A settled or
  // cancelled one is refused server-side; offering it here would just produce
  // an error the user could have been spared.
  const eligible = React.useMemo(
    () => agreements.filter((c) => attributionTargetBlockedReason(c.status) == null),
    [agreements],
  );

  const preview = useAttributionPreview({ contractorId, projectId, contractId, attendanceIds: selected });
  // A full preview always carries `blockers` of its own, so the union is
  // narrowed on a preview-only key rather than on `blockers`.
  const p = preview.data && "rowCount" in preview.data ? preview.data : null;
  const previewBlockers = p ? p.blockers : (preview.data?.blockers ?? []);

  const result = attribute.data;
  const serverBlockers = result && "blockers" in result ? result.blockers : [];

  const totalSelectedPaise = rows
    .filter((r) => selected.includes(r.id))
    .reduce((t, r) => t + r.estimatedCostPaise, 0);

  const canSave =
    selected.length > 0 &&
    !!contractId &&
    reason.trim().length > 0 &&
    previewBlockers.length === 0 &&
    !attribute.isPending;

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  /** Rows grouped by the settlement that recognised them. */
  const bySettlement = React.useMemo(() => {
    const groups = new Map<string, { period: string; rows: typeof rows }>();
    for (const r of rows) {
      const g = groups.get(r.settlementId) ?? { period: r.settlementPeriod, rows: [] };
      g.rows.push(r);
      groups.set(r.settlementId, g);
    }
    return [...groups.entries()];
  }, [rows]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Attribute settled labour</SheetTitle>
          <SheetDescription>
            {projectName} — labour that was settled without an agreement.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <p className="text-xs text-foreground-subtle">
            This assigns already-settled labour to the agreement it belongs to. It changes which
            agreement is credited — it does not pay anything, consume an advance, or alter the
            settlement.
          </p>

          {/* ── Rows ─────────────────────────────────────────────────── */}
          {isLoading ? (
            <p className="text-sm text-foreground-subtle">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-foreground-subtle">
              No settled unattributed labour on this project.
            </p>
          ) : (
            <div className="space-y-3">
              {bySettlement.map(([settlementId, g]) => {
                const ids = g.rows.map((r) => r.id);
                const allOn = ids.every((id) => selected.includes(id));
                return (
                  <div key={settlementId} className="rounded-xl border border-border bg-surface">
                    <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                      <span className="text-xs font-medium text-foreground-muted">
                        Settled {g.period}
                      </span>
                      <button
                        type="button"
                        className="text-xs text-primary transition-colors hover:underline"
                        onClick={() =>
                          setSelected((s) =>
                            allOn ? s.filter((x) => !ids.includes(x)) : [...new Set([...s, ...ids])],
                          )
                        }
                      >
                        {allOn ? "Clear all" : "Select all"}
                      </button>
                    </div>
                    <div className="divide-y divide-border">
                      {g.rows.map((r) => (
                        <label
                          key={r.id}
                          className={cn(
                            "flex cursor-pointer items-center gap-3 px-3 py-2 text-sm",
                            selected.includes(r.id) && "bg-surface-muted/40",
                          )}
                        >
                          <input
                            type="checkbox"
                            className="size-4 shrink-0 accent-primary"
                            checked={selected.includes(r.id)}
                            onChange={() => toggle(r.id)}
                            aria-label={`${r.labourTypeName} on ${r.date}`}
                          />
                          <span className="w-24 shrink-0 text-xs text-foreground-muted">
                            {formatDate(r.date)}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{r.labourTypeName}</span>
                          <span className="shrink-0 text-xs text-foreground-subtle">
                            {r.quantityPresent} ×{" "}
                            {r.dailyRatePaiseSnapshot != null ? (
                              <MoneyText paise={r.dailyRatePaiseSnapshot} whole />
                            ) : (
                              "—"
                            )}
                          </span>
                          <span className="w-24 shrink-0 text-right font-mono">
                            <MoneyText paise={r.estimatedCostPaise} />
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-foreground-subtle">
                {selected.length} of {rows.length} selected ·{" "}
                <MoneyText paise={totalSelectedPaise} className="font-medium text-foreground" />
              </p>
            </div>
          )}

          {/* ── Target ───────────────────────────────────────────────── */}
          {rows.length > 0 && (
            <div className="space-y-1.5">
              <Label>Attribute to</Label>
              <Select value={contractId ?? undefined} onValueChange={setContractId}>
                <SelectTrigger aria-label="Target agreement">
                  <SelectValue placeholder="Select agreement" />
                </SelectTrigger>
                <SelectContent>
                  {eligible.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {eligible.length === 0 && (
                <p className="text-xs text-foreground-subtle">
                  No agreement on this project can take historical credit — a settled or cancelled
                  agreement can&rsquo;t.
                </p>
              )}
            </div>
          )}

          {/* ── Reason ───────────────────────────────────────────────── */}
          {rows.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="attribution-reason">Reason</Label>
              <Input
                id="attribution-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why does this labour belong to that agreement?"
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
          )}

          {/* ── Refusals ─────────────────────────────────────────────── */}
          {[...new Set([...previewBlockers, ...serverBlockers])].map((code) => (
            <p
              key={code}
              className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-subtle/40 px-3 py-2.5 text-xs text-danger-foreground"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {describeBlocker(code)}
            </p>
          ))}

          {/* ── Preview ──────────────────────────────────────────────── */}
          {p && p.blockers.length === 0 && (
            <div className="space-y-2 rounded-lg border border-border bg-surface-muted/40 px-3 py-2.5 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs uppercase tracking-wide text-foreground-subtle">
                  Moving
                </span>
                <span className="font-mono font-medium">
                  <MoneyText paise={p.totalPaise} /> ({p.rowCount} record
                  {p.rowCount === 1 ? "" : "s"})
                </span>
              </div>
              <p className="text-xs text-foreground-muted">
                From <strong className="font-medium">unattributed settled labour</strong> to{" "}
                <strong className="font-medium text-foreground">
                  {p.target.projectName} → {p.target.title}
                </strong>
                .
              </p>

              <div className="space-y-1 border-t border-border pt-2 text-xs">
                <Row
                  label="Attendance credit"
                  before={p.before.attendanceCreditPaise}
                  after={p.after.attendanceCreditPaise}
                />
                <Row
                  label="Total credited"
                  before={p.before.totalCreditedPaise}
                  after={p.after.totalCreditedPaise}
                />
                <Row label="Currently due" before={p.before.currentDuePaise} after={p.after.currentDuePaise} />
                <Row label="Paid ahead" before={p.before.advanceCreditPaise} after={p.after.advanceCreditPaise} />
                <Row
                  label="Unattributed"
                  before={p.unattributedBeforePaise}
                  after={p.unattributedAfterPaise}
                />
              </div>

              {/* Stated, not implied. A user watching ₹2,00,000 move between
                  columns deserves to be told plainly that no money moved. */}
              <p className="flex items-start gap-1.5 border-t border-border pt-2 text-xs text-foreground-subtle">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                Cash impact <strong className="font-medium text-foreground">₹0</strong> · advance
                allocation unchanged · the settlement and its payment stay exactly as they are.
              </p>

              {p.warnings.map((w) => (
                <p
                  key={w}
                  className="flex items-start gap-1.5 rounded-md bg-warning-subtle/50 px-2 py-1.5 text-xs text-warning-foreground"
                >
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {describeWarning(w)}
                </p>
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
              attribute.mutate(
                {
                  contractorId,
                  projectId,
                  contractId: contractId!,
                  attendanceIds: selected,
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
            {attribute.isPending ? "Attributing…" : "Attribute labour"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, before, after }: { label: string; before: number; after: number }) {
  const moved = before !== after;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-foreground-subtle">{label}</span>
      <span className={cn("font-mono", moved ? "text-foreground" : "text-foreground-subtle")}>
        <MoneyText paise={before} /> <span className="text-foreground-subtle">→</span>{" "}
        <span className={cn(moved && "font-medium")}>
          <MoneyText paise={after} />
        </span>
      </span>
    </div>
  );
}
