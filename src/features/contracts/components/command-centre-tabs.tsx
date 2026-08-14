"use client";

/**
 * Scope & Labour, Rates, Milestones and History — the tabs that need per-agreement
 * data, so each renders a child component that fetches its own agreement detail.
 *
 * Same rule as the rest of the Command Centre: every financial figure comes from
 * the engine's DTO. Nothing here recalculates a formula.
 */

import * as React from "react";
import { FileText, Plus } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { MoneyText } from "@/components/patterns/money-text";
import { cn } from "@/lib/utils";
import { formatDate } from "@/features/projects/format";
import { rateBands } from "../rates";
import { useContract, useRateRevisions, useAgreementHistory } from "../hooks";
import { CreateAgreementButton } from "./command-centre";
import { ManageScopeSheet } from "./manage-scope-sheet";
import type { Contract, HistoryEvent, ScopeItem } from "../types";
import {
  CONTRACT_STATUS_LABEL,
  CONTRACT_STATUS_TONE,
  MILESTONE_FINANCIAL_LABEL,
  MILESTONE_STATUS_LABEL,
  MILESTONE_STATUS_TONE,
} from "../constants";

function CardHead({ contract, action }: { contract: Contract; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
      <span className="text-sm font-semibold">
        {contract.title}
        <span className="ml-2 text-xs font-normal text-foreground-subtle">
          {contract.projectName}
        </span>
      </span>
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px]",
            CONTRACT_STATUS_TONE[contract.status],
          )}
        >
          {CONTRACT_STATUS_LABEL[contract.status]}
        </span>
        {action}
      </span>
    </div>
  );
}

/* ── Scope & Labour ─────────────────────────────────────────────────────── */

/**
 * The labour types each agreement covers, grouped by trade.
 *
 * This is where a contractor-specific rate belongs. Users currently express the
 * same idea by creating a labour GROUP named after the contractor, which
 * duplicates the shared taxonomy; an agreement scope item carries the
 * contractor, the project and the rate without touching that trade list.
 */
export function ScopeTab({
  contracts,
  onCreateAgreement,
  canEditScope = false,
}: {
  contracts: Contract[];
  onCreateAgreement?: () => void;
  /** contracts.edit — scope is agreement configuration, not a report. */
  canEditScope?: boolean;
}) {
  if (contracts.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No agreements"
        description="Scope and rates belong to an agreement — create one first."
        action={<CreateAgreementButton onClick={onCreateAgreement} />}
      />
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-foreground-subtle">
        Trade groups stay shared across the company; the contractor-specific rate lives on the
        agreement.
      </p>
      {contracts.map((c) => (
        <AgreementScopeCard key={c.id} contract={c} canEdit={canEditScope} />
      ))}
    </div>
  );
}

function AgreementScopeCard({ contract, canEdit }: { contract: Contract; canEdit: boolean }) {
  const { data, isLoading } = useContract(contract.id);
  const [manageOpen, setManageOpen] = React.useState(false);
  const items = data?.scopeItems ?? [];

  // Grouped so the taxonomy reads Trade → Labour type, matching how the labour
  // module is organised.
  const byCategory = new Map<string, ScopeItem[]>();
  for (const i of items) {
    const list = byCategory.get(i.categoryName) ?? [];
    list.push(i);
    byCategory.set(i.categoryName, list);
  }

  return (
    <div className="rounded-xl border border-border bg-surface">
      <CardHead
        contract={contract}
        action={
          canEdit && items.length > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => setManageOpen(true)}>
              <Plus />
              Manage scope
            </Button>
          ) : undefined
        }
      />
      {isLoading ? (
        <p className="px-4 py-3 text-sm text-foreground-subtle">Loading scope…</p>
      ) : items.length === 0 ? (
        <div className="space-y-2 px-4 py-4">
          <p className="text-sm font-medium">No labour types in scope yet</p>
          <p className="text-sm text-foreground-subtle">
            Choose the labour types this contractor supplies under this agreement.
          </p>
          {canEdit && (
            <Button variant="primary" size="sm" onClick={() => setManageOpen(true)}>
              <Plus />
              Add labour types
            </Button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {[...byCategory.entries()].map(([category, rows]) => (
            <div key={category} className="px-4 py-2.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">
                {category}
              </p>
              <div className="mt-1 space-y-1">
                {rows.map((i) => (
                  <div key={i.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span>{i.subcategoryName}</span>
                    <span className="font-mono text-foreground-muted">
                      <MoneyText paise={i.currentRatePaise} />
                      <span className="ml-1 text-xs text-foreground-subtle">/{i.rateUnit}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <ManageScopeSheet open={manageOpen} onOpenChange={setManageOpen} contract={contract} />
      )}
    </div>
  );
}

/* ── Rates ──────────────────────────────────────────────────────────────── */

/**
 * The current rate and its full effective-dated history.
 *
 * Revisions are APPEND-ONLY: a change adds a row, it never overwrites the
 * previous rate. That is what lets attendance recorded months ago keep valuing
 * at the rate actually in force on its own date.
 */
export function RatesTab({
  contracts,
  onCreateAgreement,
}: {
  contracts: Contract[];
  onCreateAgreement?: () => void;
}) {
  if (contracts.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No agreements"
        description="A contractor-specific rate lives on an agreement's scope, so there is nothing to price yet."
        action={<CreateAgreementButton onClick={onCreateAgreement} />}
      />
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-foreground-subtle">
        Rate revisions are append-only — an earlier rate is never overwritten, so historical
        attendance keeps the rate that applied on its own date.
      </p>
      {contracts.map((c) => (
        <AgreementRatesCard key={c.id} contract={c} />
      ))}
    </div>
  );
}

function AgreementRatesCard({ contract }: { contract: Contract }) {
  const { data } = useContract(contract.id);
  const items = data?.scopeItems ?? [];
  return (
    <div className="rounded-xl border border-border bg-surface">
      <CardHead contract={contract} />
      {items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-foreground-subtle">
          No rates configured yet — add labour types under Scope &amp; Labour and each one brings
          its agreed rate.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {items.map((i) => (
            <ScopeItemRates key={i.id} item={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function ScopeItemRates({ item }: { item: ScopeItem }) {
  const { data: revisions = [] } = useRateRevisions(item.id);
  // Bands are DERIVED from the revisions — there is no stored effectiveTo, so
  // there is no closing date that can drift out of step with the next row.
  const bands = rateBands(revisions);

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">
          {item.subcategoryName}
          <span className="ml-1.5 text-xs font-normal text-foreground-subtle">
            {item.categoryName}
          </span>
        </span>
        <span className="font-mono text-sm">
          <MoneyText paise={item.currentRatePaise} />
          <span className="ml-1 text-xs text-foreground-subtle">/{item.rateUnit} today</span>
        </span>
      </div>

      {bands.length > 0 && (
        <div className="mt-2 space-y-1 border-l border-border pl-3">
          {bands
            .slice()
            .reverse()
            .map((b) => (
              <div
                key={b.revisionId}
                className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-foreground-subtle"
              >
                <span>
                  {formatDate(b.fromDate)} → {b.toDate ? formatDate(b.toDate) : "current"}
                  {b.reason && <span className="ml-1.5">· {b.reason}</span>}
                </span>
                <MoneyText paise={b.ratePaise} className="font-mono" />
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/* ── Milestones ─────────────────────────────────────────────────────────── */

/**
 * Physical progress and financial coverage, side by side.
 *
 * Three distinct facts per checkpoint: what physically happened, whether it is
 * covered by today's credits, and what was owed the day it completed. The last
 * never changes; the middle one does, as money arrives.
 */
export function MilestonesTab({
  contracts,
  onCreateAgreement,
}: {
  contracts: Contract[];
  onCreateAgreement?: () => void;
}) {
  if (contracts.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No agreements"
        description="Milestones are how an agreement earns its value, so they belong to one."
        action={<CreateAgreementButton onClick={onCreateAgreement} />}
      />
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-foreground-subtle">
        A slab can be physically complete and still unpaid, and become covered later — without its
        position at completion changing.
      </p>
      {contracts.map((c) => (
        <AgreementMilestonesCard key={c.id} contract={c} />
      ))}
    </div>
  );
}

function AgreementMilestonesCard({ contract }: { contract: Contract }) {
  const { data, isLoading } = useContract(contract.id);
  const milestones = data?.milestones ?? [];
  const r = contract.reconciliation;

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <span className="text-sm font-semibold">
          {contract.title}
          <span className="ml-2 text-xs font-normal text-foreground-subtle">
            {contract.projectName}
          </span>
        </span>
        <span className="text-xs text-foreground-subtle">
          {r.milestonesCompleted}/{r.milestonesTotal} complete · earned{" "}
          <MoneyText paise={r.earnedValuePaise} />
        </span>
      </div>

      {isLoading ? (
        <p className="px-4 py-3 text-sm text-foreground-subtle">Loading milestones…</p>
      ) : milestones.length === 0 ? (
        <p className="px-4 py-3 text-sm text-foreground-subtle">No milestones yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="grid grid-cols-[1fr_120px_120px_1fr] gap-2 border-b border-border px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">
              <span>Milestone</span>
              <span>Value</span>
              <span className="text-center">Physical</span>
              <span>Financial coverage</span>
            </div>
            <div className="divide-y divide-border">
              {milestones.map((m) => (
                <MilestoneRow
                  key={m.id}
                  title={m.title}
                  valuePaise={m.valuePaise}
                  status={m.status}
                  currentCoverage={m.currentCoverageState}
                  atCompletion={m.financialStateAtCompletion}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** One checkpoint: physical status, and the two financial views kept apart. */
export function MilestoneRow({
  title,
  valuePaise,
  status,
  currentCoverage,
  atCompletion,
}: {
  title: string;
  valuePaise: number;
  status: keyof typeof MILESTONE_STATUS_LABEL;
  currentCoverage: keyof typeof MILESTONE_FINANCIAL_LABEL;
  atCompletion: keyof typeof MILESTONE_FINANCIAL_LABEL;
}) {
  return (
    <div className="grid grid-cols-[1fr_120px_120px_1fr] items-center gap-2 px-4 py-2.5 text-sm">
      <span className="font-medium">{title}</span>
      <MoneyText paise={valuePaise} className="font-mono" />
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-center text-[11px]",
          MILESTONE_STATUS_TONE[status],
        )}
      >
        {MILESTONE_STATUS_LABEL[status]}
      </span>
      <span className="text-xs text-foreground-subtle">
        Now: <strong className="font-medium">{MILESTONE_FINANCIAL_LABEL[currentCoverage]}</strong> ·
        At completion: {MILESTONE_FINANCIAL_LABEL[atCompletion]}
      </span>
    </div>
  );
}

/* ── History ────────────────────────────────────────────────────────────── */

/** Colour by what the event did, so a reversal reads differently from a payment. */
const ACTION_TONE: Record<string, string> = {
  "contract.created": "bg-surface-muted text-foreground-muted",
  "contract.amendment_created": "bg-warning-subtle text-warning-foreground",
  "contract.amendment_approved": "bg-success-subtle text-success-foreground",
  "contract.amendment_rejected": "bg-surface-muted text-foreground-subtle",
  "contract.milestone_completed": "bg-success-subtle text-success-foreground",
  "contract.rate_revised": "bg-info-subtle text-info-foreground",
  "contract.payment_recorded": "bg-success-subtle text-success-foreground",
  "contract.payment_reversed": "bg-danger-subtle text-danger-foreground",
  "contract.cancelled": "bg-danger-subtle text-danger-foreground",
  "contractor.settlement_reversed": "bg-danger-subtle text-danger-foreground",
};

/** "contract.amendment_approved" → "Amendment approved". */
function actionLabel(action: string): string {
  const tail = action.split(".").slice(1).join(" ").replace(/_/g, " ");
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

export function HistoryTab({ contractorId }: { contractorId: string }) {
  const { data: events = [], isLoading } = useAgreementHistory(contractorId);

  if (isLoading) {
    return <p className="text-sm text-foreground-subtle">Loading history…</p>;
  }
  if (events.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No history yet"
        description="Amendments, rate revisions, milestone completions, payments and reversals appear here as they happen."
      />
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-foreground-subtle">
        Audited commercial events, newest first. Reversed and rejected entries stay listed — history
        records what happened, not only what still stands.
      </p>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="divide-y divide-border">
          {events.map((e) => (
            <HistoryRow key={e.id} event={e} />
          ))}
        </div>
      </div>
    </div>
  );
}

function HistoryRow({ event: e }: { event: HistoryEvent }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px]",
              ACTION_TONE[e.action] ?? "bg-surface-muted text-foreground-muted",
            )}
          >
            {actionLabel(e.action)}
          </span>
          <span className="truncate">{e.summary}</span>
        </div>
        <p className="mt-0.5 text-xs text-foreground-subtle">
          {formatDate(e.at.slice(0, 10))}
          {e.actorName && ` · ${e.actorName}`}
          {e.contractTitle && ` · ${e.contractTitle}`}
          {e.projectName && ` · ${e.projectName}`}
        </p>
      </div>
      {e.amountPaise != null && (
        <MoneyText paise={e.amountPaise} className="font-mono text-foreground-muted" />
      )}
    </div>
  );
}
