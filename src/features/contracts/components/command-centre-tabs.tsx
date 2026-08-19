"use client";

/**
 * Scope & Labour, Rates, Milestones and History — the tabs that need per-agreement
 * data, so each renders a child component that fetches its own agreement detail.
 *
 * Same rule as the rest of the Command Centre: every financial figure comes from
 * the engine's DTO. Nothing here recalculates a formula.
 */

import * as React from "react";
import { FileText, Layers, PencilLine, Plus } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { MoneyText } from "@/components/patterns/money-text";
import { cn } from "@/lib/utils";
import { formatDate } from "@/features/projects/format";
import { rateBands, rateRevisionBlockedReason } from "../rates";
import { milestoneCoverage } from "../milestones";
import {
  approvedDeltaPaise,
  approveBlockedReason,
  canProposeAmendment,
  isStale,
} from "../amendments";
import { useCan } from "@/features/rbac/permission-context";
import {
  useAmendments,
  useContract,
  useRateRevisions,
  useAgreementHistory,
  useReorderMilestones,
} from "../hooks";
import { CreateAgreementButton } from "./command-centre";
import { ManageScopeSheet } from "./manage-scope-sheet";
import { ReviseRateSheet } from "./revise-rate-sheet";
import { MilestoneActionsMenu } from "./milestone-actions";
import { MilestoneFormSheet } from "./milestone-form-sheet";
import { BulkMilestonesSheet } from "./bulk-milestones-sheet";
import {
  AmendmentDecisionButtons,
  ProposeAmendmentButton,
} from "./amendment-actions";
import type { Amendment, Contract, HistoryEvent, Milestone, ScopeItem } from "../types";
import {
  AMENDMENT_STATUS_LABEL,
  AMENDMENT_TYPE_LABEL,
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
  const can = useCan();
  // The same permission the server demands of setScopeRate. A viewer reads the
  // whole history; only an editor can add to it.
  const canRevise = can("contracts.edit") && canTakeRateRevision(contract.status);

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
            <ScopeItemRates key={i.id} item={i} contract={contract} canRevise={canRevise} />
          ))}
        </div>
      )}
      {items.length > 0 && !canRevise && !canTakeRateRevision(contract.status) && (
        <p className="border-t border-border px-4 py-2 text-xs text-foreground-subtle">
          This agreement is {contract.status === "CANCELLED" ? "cancelled" : "closed out as settled"},
          so its rates are read-only — no attendance can attach to it, so a new rate would price
          nothing.
        </p>
      )}
    </div>
  );
}

/** Local midnight, as YYYY-MM-DD — matches how the server stamps effectiveFrom. */
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Rates can only be revised where attendance could still resolve against them. */
function canTakeRateRevision(status: string): boolean {
  return rateRevisionBlockedReason(status) == null;
}

export function ScopeItemRates({
  item,
  contract,
  canRevise,
}: {
  item: ScopeItem;
  contract: Contract;
  /** Omitted/false renders history only — no Revise action. */
  canRevise?: boolean;
}) {
  const { data: revisions = [] } = useRateRevisions(item.id);
  const [reviseOpen, setReviseOpen] = React.useState(false);
  // Bands are DERIVED from the revisions — there is no stored effectiveTo, so
  // there is no closing date that can drift out of step with the next row.
  const bands = rateBands(revisions);
  const today = todayISO();
  // A band starting after today is SCHEDULED, not current. `currentRatePaise` is
  // recomputed server-side as at today for exactly this reason, so the two agree.
  const scheduled = bands.filter((b) => b.fromDate > today);
  const past = bands.filter((b) => b.fromDate <= today);

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">
          {item.subcategoryName}
          <span className="ml-1.5 text-xs font-normal text-foreground-subtle">
            {item.categoryName}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm">
            <MoneyText paise={item.currentRatePaise} />
            <span className="ml-1 text-xs text-foreground-subtle">/{item.rateUnit} today</span>
          </span>
          {canRevise && (
            <Button variant="ghost" size="sm" onClick={() => setReviseOpen(true)}>
              <PencilLine />
              Revise rate
            </Button>
          )}
        </span>
      </div>

      {scheduled.length > 0 && (
        <div className="mt-2 space-y-1 border-l border-primary/40 pl-3">
          {scheduled
            .slice()
            .reverse()
            .map((b) => (
              <div
                key={b.revisionId}
                className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-primary"
              >
                <span>
                  {formatDate(b.fromDate)} → scheduled
                  {b.reason && <span className="ml-1.5 text-foreground-subtle">· {b.reason}</span>}
                </span>
                <MoneyText paise={b.ratePaise} className="font-mono" />
              </div>
            ))}
        </div>
      )}

      {past.length > 0 && (
        <div className="mt-2 space-y-1 border-l border-border pl-3">
          {past
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

      {canRevise && (
        <ReviseRateSheet
          item={item}
          contract={contract}
          open={reviseOpen}
          onOpenChange={setReviseOpen}
        />
      )}
    </div>
  );
}

/* ── Milestones ─────────────────────────────────────────────────────────── */

/**
 * The earned-value management surface.
 *
 * A milestone is a checkpoint that says how much of the WHOLE agreement has been
 * earned once it completes — never a wallet holding a share of the money. That is
 * why no payment figure appears on a milestone row: payments are cumulative at
 * agreement level, and printing one beside a slab would invite exactly the
 * "₹8,00,000 against Slab 1" reading the model exists to prevent.
 *
 * Every figure comes from the reconciliation DTO or from the pure
 * `milestoneCoverage` projection over it. Nothing here recomputes a formula.
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
        Completing a milestone recognises its value as earned against the whole agreement. It moves
        no money: a slab can be complete and still unpaid, and become covered later — without its
        position at completion changing.
      </p>
      {contracts.map((c) => (
        <AgreementMilestonesCard key={c.id} contract={c} />
      ))}
    </div>
  );
}

/** Agreement value / planned / earned / completed / coverage, then the rows. */
function AgreementMilestonesCard({ contract }: { contract: Contract }) {
  const can = useCan();
  const { data, isLoading } = useContract(contract.id);
  const reorder = useReorderMilestones();
  const [addOpen, setAddOpen] = React.useState(false);
  const [bulkOpen, setBulkOpen] = React.useState(false);

  const r = contract.reconciliation;
  const coverage = milestoneCoverage(r);

  const canEdit = can("contracts.edit");
  // A cancelled or settled agreement takes no earned-value change — the server
  // refuses it, so the buttons are not offered either.
  const acceptsChange = contract.status !== "CANCELLED" && contract.status !== "SETTLED";
  const canAdd = canEdit && acceptsChange;

  // Presentation order is the server's `sequence`; ties break on id so two
  // milestones sharing a sequence still order deterministically.
  const ordered = React.useMemo(
    () =>
      [...(data?.milestones ?? [])].sort((a, b) =>
        a.sequence !== b.sequence ? a.sequence - b.sequence : a.id < b.id ? -1 : 1,
      ),
    [data?.milestones],
  );

  function move(index: number, delta: number) {
    const next = [...ordered];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorder.mutate({ contractId: contract.id, orderedIds: next.map((m) => m.id) });
  }

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <span className="text-sm font-semibold">
          {contract.title}
          <span className="ml-2 text-xs font-normal text-foreground-subtle">
            {contract.projectName}
          </span>
          <span
            className={cn(
              "ml-2 rounded-full px-2 py-0.5 text-[11px] font-normal",
              CONTRACT_STATUS_TONE[contract.status],
            )}
          >
            {CONTRACT_STATUS_LABEL[contract.status]}
          </span>
        </span>
        {canAdd && (
          <span className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
              <Plus />
              Add milestone
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setBulkOpen(true)}>
              <Layers />
              Bulk
            </Button>
          </span>
        )}
      </div>

      {/* The five figures that answer "where does this agreement stand?" */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-b border-border px-4 py-3 sm:grid-cols-4">
        <Figure label="Agreement value" paise={r.currentContractValuePaise} />
        <Figure label="Planned milestone value" paise={coverage.plannedPaise} />
        <Figure label="Earned value" paise={r.earnedValuePaise} tone="text-success-foreground" />
        <div>
          <p className="text-xs text-foreground-subtle">Completed</p>
          <p className="font-mono text-sm">
            {r.milestonesCompleted}/{r.milestonesTotal}
          </p>
        </div>
      </div>

      <CoverageNote coverage={coverage} />

      {isLoading ? (
        <p className="px-4 py-3 text-sm text-foreground-subtle">Loading milestones…</p>
      ) : ordered.length === 0 ? (
        <div className="space-y-2 px-4 py-4">
          <p className="text-sm font-medium">No milestones yet</p>
          <p className="text-sm text-foreground-subtle">
            Until this agreement has milestones it can never earn anything, so reconciliation will
            keep reporting nothing due.
          </p>
          {canAdd && (
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={() => setBulkOpen(true)}>
                <Layers />
                Create in bulk
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
                <Plus />
                Add one
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[32px_1fr_110px_120px_1fr_40px] gap-2 border-b border-border px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">
              <span>#</span>
              <span>Milestone</span>
              <span className="text-right">Value</span>
              <span className="text-center">Physical</span>
              <span>Financial coverage</span>
              <span />
            </div>
            <div className="divide-y divide-border">
              {ordered.map((m, i) => (
                <MilestoneRow
                  key={m.id}
                  index={i}
                  milestone={m}
                  actions={
                    <MilestoneActionsMenu
                      contract={contract}
                      milestone={m}
                      onMoveUp={canEdit && i > 0 ? () => move(i, -1) : undefined}
                      onMoveDown={
                        canEdit && i < ordered.length - 1 ? () => move(i, 1) : undefined
                      }
                    />
                  }
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {canAdd && (
        <>
          <MilestoneFormSheet open={addOpen} onOpenChange={setAddOpen} contract={contract} />
          <BulkMilestonesSheet
            open={bulkOpen}
            onOpenChange={setBulkOpen}
            contract={contract}
            existingCount={ordered.length}
          />
        </>
      )}
    </div>
  );
}

function Figure({ label, paise, tone }: { label: string; paise: number; tone?: string }) {
  return (
    <div>
      <p className="text-xs text-foreground-subtle">{label}</p>
      <MoneyText paise={paise} className={cn("font-mono text-sm", tone)} />
    </div>
  );
}

/**
 * Planned coverage against the authorised value.
 *
 * Over-coverage is a WARNING, not an error: planning more than the agreement is a
 * normal setup state, and values are never silently normalised. What is refused
 * is RECOGNISING more than the authorised value by completing milestones.
 */
function CoverageNote({ coverage }: { coverage: ReturnType<typeof milestoneCoverage> }) {
  if (coverage.state === "EXACT") {
    return (
      <p className="border-b border-border px-4 py-2 text-xs text-success-foreground">
        {coverage.message}
      </p>
    );
  }
  if (coverage.state === "OVER") {
    return (
      <p className="border-b border-border bg-warning-subtle/40 px-4 py-2 text-xs text-warning-foreground">
        <strong className="font-medium">Over-covered:</strong> {coverage.message} Milestones may be
        planned past the agreement, but completing them past it is refused — raise an amendment to
        increase the agreement value first.
      </p>
    );
  }
  return (
    <p className="border-b border-border px-4 py-2 text-xs text-foreground-subtle">
      {coverage.message}
    </p>
  );
}

/** One checkpoint: physical status, and the two financial views kept apart. */
export function MilestoneRow({
  index,
  milestone: m,
  actions,
}: {
  index: number;
  milestone: Milestone;
  actions?: React.ReactNode;
}) {
  const earning = m.status === "COMPLETED";
  return (
    <div className="grid grid-cols-[32px_1fr_110px_120px_1fr_40px] items-center gap-2 px-4 py-2.5 text-sm">
      <span className="font-mono text-xs text-foreground-subtle">{index + 1}</span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{m.title}</span>
        <span className="text-xs text-foreground-subtle">
          {m.plannedDate ? `Target ${formatDate(m.plannedDate)}` : "No target date"}
          {m.completedAt && ` · Completed ${formatDate(m.completedAt.slice(0, 10))}`}
          {m.cancelledReason && ` · ${m.cancelledReason}`}
        </span>
      </span>
      <span className="text-right">
        <MoneyText paise={m.valuePaise} className="font-mono" />
        <span className="block text-[10px] text-foreground-subtle">
          {earning ? "counts as earned" : "not earned yet"}
        </span>
      </span>
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-center text-[11px]",
          MILESTONE_STATUS_TONE[m.status],
        )}
      >
        {MILESTONE_STATUS_LABEL[m.status]}
      </span>
      <span className="text-xs text-foreground-subtle">
        Now:{" "}
        <strong className="font-medium">{MILESTONE_FINANCIAL_LABEL[m.currentCoverageState]}</strong>{" "}
        · At completion: {MILESTONE_FINANCIAL_LABEL[m.financialStateAtCompletion]}
      </span>
      <span className="flex justify-end">{actions}</span>
    </div>
  );
}

/* ── Amendments ─────────────────────────────────────────────────────────── */

/**
 * The amendment register: what was signed, what has been authorised since, and
 * what is waiting on a decision.
 *
 * The three figures are kept apart on purpose. `₹65,00,000` is what this
 * agreement currently authorises; it is NOT what anybody signed. The original
 * value stays legible forever, and the deltas in between explain the difference.
 *
 * A PROPOSED amendment is shown as an intention, never folded into the total —
 * approving it is what moves the value, and until then reconciliation, the
 * earned-value ceiling and milestone coverage all still use the current figure.
 */
export function AmendmentsTab({
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
        description="An amendment revises an agreement's authorised value, so it belongs to one."
        action={<CreateAgreementButton onClick={onCreateAgreement} />}
      />
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-foreground-subtle">
        The agreed value is never edited in place. An amendment records what changed, why, and who
        approved it — so the original figure and the current authorised figure both stay readable.
      </p>
      {contracts.map((c) => (
        <AgreementAmendmentsCard key={c.id} contract={c} />
      ))}
    </div>
  );
}

function AgreementAmendmentsCard({ contract }: { contract: Contract }) {
  const can = useCan();
  const { data: amendments = [], isLoading } = useAmendments(contract.id);
  const r = contract.reconciliation;

  const canPropose = can("contracts.edit") && canProposeAmendment(contract.status);
  const canDecide = can("contracts.amend_approve");
  const lifecycleBlocked = approveBlockedReason(contract.status);

  // Σ APPROVED deltas — derived from the amendments themselves, and equal to the
  // engine's `amendmentDeltaPaise` by construction.
  const approvedDelta = approvedDeltaPaise(amendments);
  const pending = amendments.filter((a) => a.status === "PROPOSED");

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <span className="text-sm font-semibold">
          {contract.title}
          <span className="ml-2 text-xs font-normal text-foreground-subtle">
            {contract.projectName}
          </span>
          <span
            className={cn(
              "ml-2 rounded-full px-2 py-0.5 text-[11px] font-normal",
              CONTRACT_STATUS_TONE[contract.status],
            )}
          >
            {CONTRACT_STATUS_LABEL[contract.status]}
          </span>
        </span>
        {canPropose && <ProposeAmendmentButton contract={contract} />}
      </div>

      {/* Original → approved amendments → current authorised. Never collapsed. */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-1 border-b border-border px-4 py-3 text-sm sm:grid-cols-3">
        <div className="flex items-baseline justify-between sm:block">
          <p className="text-xs text-foreground-subtle">Original agreement value</p>
          <MoneyText paise={r.originalContractValuePaise} className="font-mono" />
        </div>
        <div className="flex items-baseline justify-between sm:block">
          <p className="text-xs text-foreground-subtle">Approved amendments</p>
          <span
            className={cn(
              "font-mono",
              approvedDelta > 0 && "text-success-foreground",
              approvedDelta < 0 && "text-danger-foreground",
            )}
          >
            {approvedDelta > 0 && "+"}
            {approvedDelta < 0 && "−"}
            <MoneyText paise={Math.abs(approvedDelta)} />
          </span>
        </div>
        <div className="flex items-baseline justify-between sm:block">
          <p className="text-xs text-foreground-subtle">Current authorised value</p>
          <MoneyText paise={r.currentContractValuePaise} className="font-mono font-semibold" />
        </div>
      </div>

      {pending.length > 0 && (
        <p className="border-b border-border bg-warning-subtle/40 px-4 py-2 text-xs text-warning-foreground">
          {pending.length} amendment{pending.length === 1 ? "" : "s"} awaiting a decision. Nothing
          changes until one is approved — the agreement still authorises{" "}
          <MoneyText paise={r.currentContractValuePaise} />.
        </p>
      )}

      {isLoading ? (
        <p className="px-4 py-3 text-sm text-foreground-subtle">Loading amendments…</p>
      ) : amendments.length === 0 ? (
        <div className="space-y-2 px-4 py-4">
          <p className="text-sm font-medium">No amendments</p>
          <p className="text-sm text-foreground-subtle">
            This agreement still stands at the value it was signed for.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {[...amendments]
            .sort((a, b) => b.sequence - a.sequence)
            .map((a) => (
              <AmendmentRow
                key={a.id}
                contract={contract}
                amendment={a}
                canDecide={canDecide}
                lifecycleBlocked={lifecycleBlocked}
              />
            ))}
        </div>
      )}
    </div>
  );
}

const AMENDMENT_STATUS_TONE: Record<Amendment["status"], string> = {
  PROPOSED: "bg-warning-subtle text-warning-foreground",
  APPROVED: "bg-success-subtle text-success-foreground",
  REJECTED: "bg-surface-muted text-foreground-subtle line-through",
};

function AmendmentRow({
  contract,
  amendment: a,
  canDecide,
  lifecycleBlocked,
}: {
  contract: Contract;
  amendment: Amendment;
  canDecide: boolean;
  lifecycleBlocked: string | null;
}) {
  const proposed = a.status === "PROPOSED";
  const stale = proposed && isStale(a, contract.reconciliation.currentContractValuePaise);

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn("rounded-full px-2 py-0.5 text-[11px]", AMENDMENT_STATUS_TONE[a.status])}
          >
            {AMENDMENT_STATUS_LABEL[a.status]}
          </span>
          <span className="text-xs text-foreground-subtle">{AMENDMENT_TYPE_LABEL[a.type]}</span>
          <span
            className={cn(
              "font-mono text-sm font-medium",
              a.deltaPaise > 0 ? "text-success-foreground" : "text-danger-foreground",
            )}
          >
            {a.deltaPaise > 0 ? "+" : "−"}
            <MoneyText paise={Math.abs(a.deltaPaise)} />
          </span>
        </div>
        <p className="mt-0.5 truncate">{a.reason}</p>
        <p className="mt-0.5 text-xs text-foreground-subtle">
          <MoneyText paise={a.previousAmountPaise} /> → <MoneyText paise={a.revisedAmountPaise} />
          {" · effective "}
          {formatDate(a.effectiveDate)}
          {a.requestedByName && ` · raised by ${a.requestedByName}`}
          {a.approvedByName &&
            a.status !== "PROPOSED" &&
            ` · ${a.status === "APPROVED" ? "approved" : "rejected"} by ${a.approvedByName}`}
        </p>
        {a.rejectedReason && (
          <p className="mt-0.5 text-xs text-danger-foreground">Rejected: {a.rejectedReason}</p>
        )}
        {stale && (
          <p className="mt-0.5 text-xs text-danger-foreground">
            Raised against <MoneyText paise={a.previousAmountPaise} />, but the agreement now
            authorises{" "}
            <MoneyText paise={contract.reconciliation.currentContractValuePaise} /> — it needs
            raising again.
          </p>
        )}
      </div>

      {proposed && canDecide && !lifecycleBlocked && (
        <AmendmentDecisionButtons contract={contract} amendment={a} />
      )}
      {proposed && canDecide && lifecycleBlocked && (
        <span className="max-w-[220px] shrink-0 text-right text-xs text-foreground-subtle">
          {lifecycleBlocked}
        </span>
      )}
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
