"use client";

/**
 * The Contractor Commercial Command Centre — the tab bodies.
 *
 * One rule governs every figure here: **it comes from the canonical
 * reconciliation DTO produced by the engine.** No component in this file
 * reimplements or locally recalculates a financial formula; they read
 * `contract.reconciliation` and `group.rollup` and render them.
 *
 * The second rule is about presentation rather than arithmetic: **Due and Ahead
 * are never netted.** They belong to different agreements, and collapsing
 * "₹8,00,000 due, ₹3,00,000 ahead" into "₹5,00,000 net due" would erase a real
 * obligation. Net position is shown once, muted, clearly labelled informational.
 */

import * as React from "react";
import { FileText, Info, Plus } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";
import { MoneyText } from "@/components/patterns/money-text";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDate } from "@/features/projects/format";
import type {
  AgreementReconciliation,
  Contract,
  ContractorProfile,
  ContractPaymentHistoryRow,
} from "../types";
import {
  CONTRACT_STATUS_LABEL,
  CONTRACT_STATUS_TONE,
  PAYMENT_MODE_LABEL,
  PAYMENT_TYPE_LABEL,
} from "../constants";

/**
 * The settlement fields these tabs render. Declared structurally rather than
 * imported from the contractors module, so the commercial views stay readable
 * without coupling the two feature folders together.
 */
export interface SettlementRow {
  id: string;
  projectName: string;
  periodStart: string;
  periodEnd: string;
  labourBillPaise: number;
  advanceAdjustmentPaise: number;
  netPaymentPaise: number;
  reversedAt?: string | null;
  reversalReason?: string | null;
}

/* ── Shared primitives ──────────────────────────────────────────────────── */

export function Stat({
  label,
  money,
  value,
  tone,
  hint,
}: {
  label: string;
  money?: number;
  value?: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <p className="text-xs text-foreground-subtle">{label}</p>
      <p className={cn("mt-0.5 font-mono text-lg font-semibold", tone)}>
        {money != null ? <MoneyText paise={money} /> : value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-foreground-subtle">{hint}</p>}
    </div>
  );
}

function Line({
  label,
  paise,
  tone,
  strong,
  note,
}: {
  label: string;
  paise: number;
  tone?: string;
  strong?: boolean;
  note?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className={cn("text-sm", strong ? "font-medium" : "text-foreground-muted")}>
        {label}
        {note && <span className="ml-1.5 text-xs text-foreground-subtle">{note}</span>}
      </span>
      <MoneyText paise={paise} className={cn("font-mono", strong && "font-semibold", tone)} />
    </div>
  );
}

/**
 * Labour recorded on a project that no agreement has claimed. Shown OUTSIDE
 * every agreement total, because reconciliation must not guess which agreement
 * unattributed labour belongs to.
 */
export function UnattributedBanner({ paise, projectName }: { paise: number; projectName?: string }) {
  if (paise <= 0) return null;
  return (
    <div className="flex gap-2.5 rounded-lg border border-border bg-surface-muted/50 px-3 py-2.5 text-xs text-foreground-muted">
      <Info className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
      <p>
        <MoneyText paise={paise} className="font-medium text-foreground" /> of settled labour
        {projectName ? ` on ${projectName}` : ""} isn&rsquo;t attributed to an agreement yet, so it
        is <strong>not counted</strong> in any agreement below. Attribution arrives with the
        agreement-aware attendance flow.
      </p>
    </div>
  );
}

/* ── Overview ───────────────────────────────────────────────────────────── */

export function OverviewTab({
  profile,
  onCreateAgreement,
}: {
  profile: ContractorProfile;
  /** Omitted when the viewer lacks contracts.create. */
  onCreateAgreement?: () => void;
}) {
  const l = profile.lifetime;
  if (l.agreementCount === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No agreements yet"
        description="An agreement is this contractor's commercial arrangement on a project — its value, scope, rates and milestones. Without one you can still record attendance, pay advances and settle weekly; an agreement is what adds earned value and what is genuinely payable today."
        action={<CreateAgreementButton onClick={onCreateAgreement} />}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Agreement value" money={l.totalContractValuePaise} />
        <Stat label="Earned" money={l.totalEarnedPaise} />
        <Stat label="Credited" money={l.totalCreditedPaise} tone="text-success-foreground" />
        {/* Due and Ahead sit side by side and are NEVER combined. */}
        <Stat label="Currently due" money={l.totalCurrentDuePaise} tone="text-warning-foreground" />
        <Stat label="Paid ahead" money={l.totalAdvanceCreditPaise} />
        <Stat label="Unsettled labour" money={l.totalUnsettledAttendancePaise} />
      </div>

      <p className="text-xs text-foreground-subtle">
        Due and Ahead belong to different agreements and are shown separately — one agreement&rsquo;s
        advance does not settle another&rsquo;s liability. Net commercial position (informational
        only): <MoneyText paise={l.netCommercialPositionPaise} className="font-mono" />.
      </p>

      <div className="space-y-3">
        {profile.projects.map((g) => (
          <div key={g.projectId} className="rounded-xl border border-border bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <span className="text-sm font-semibold">{g.projectName}</span>
              <span className="text-xs text-foreground-subtle">
                {g.rollup.agreementCount} agreement{g.rollup.agreementCount === 1 ? "" : "s"} · Due{" "}
                <MoneyText paise={g.rollup.totalCurrentDuePaise} /> · Ahead{" "}
                <MoneyText paise={g.rollup.totalAdvanceCreditPaise} />
              </span>
            </div>
            <div className="divide-y divide-border">
              {g.contracts.map((c) => (
                <AgreementRow key={c.id} contract={c} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Agreements ─────────────────────────────────────────────────────────── */

function AgreementRow({ contract: c }: { contract: Contract }) {
  const r = c.reconciliation;
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{c.title}</span>
            {c.reference && (
              <span className="text-xs text-foreground-subtle">{c.reference}</span>
            )}
            <span
              className={cn("rounded-full px-2 py-0.5 text-[11px]", CONTRACT_STATUS_TONE[c.status])}
            >
              {CONTRACT_STATUS_LABEL[c.status]}
            </span>
          </div>
          {c.scope && <p className="mt-0.5 text-xs text-foreground-subtle">{c.scope}</p>}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        <Line label="Authorised value" paise={c.currentAmountPaise} />
        <Line
          label="Earned"
          paise={r.earnedValuePaise}
          note={`${r.milestonesCompleted}/${r.milestonesTotal}`}
        />
        <Line label="Attendance credit" paise={r.attendanceCreditPaise} />
        <Line label="Other payments" paise={r.otherPaymentCreditPaise} />
        <Line label="Total credited" paise={r.totalCreditedPaise} tone="text-success-foreground" />
        {r.advanceCreditPaise > 0 ? (
          <Line label="Paid ahead" paise={r.advanceCreditPaise} strong />
        ) : (
          <Line
            label="Currently due"
            paise={r.currentDuePaise}
            tone="text-warning-foreground"
            strong
          />
        )}
        <Line label="Remaining unearned" paise={r.remainingUnearnedPaise} />
        <Line label="Overall balance" paise={r.overallBalancePaise} />
        {r.unsettledAttendancePaise > 0 && (
          <Line label="Unsettled labour" paise={r.unsettledAttendancePaise} note="informational" />
        )}
      </div>

      {r.earnedValueExcessPaise > 0 && (
        <p className="mt-1.5 text-xs text-danger-foreground">
          Milestones recognise <MoneyText paise={r.earnedValueExcessPaise} /> more than the
          authorised value. Raise an amendment.
        </p>
      )}
    </div>
  );
}

/**
 * The one action that turns an attendance-only contractor into a commercial
 * one. Rendered only when the viewer may create agreements; without the
 * permission the empty state explains the concept and offers nothing to click,
 * rather than a button that would 403.
 */
export function CreateAgreementButton({
  onClick,
  size = "sm",
}: {
  onClick?: () => void;
  size?: "sm" | "md";
}) {
  if (!onClick) return null;
  return (
    <Button variant="primary" size={size} onClick={onClick}>
      <Plus />
      Create agreement
    </Button>
  );
}

export function AgreementsTab({
  profile,
  unattributedPaise,
  onCreateAgreement,
}: {
  profile: ContractorProfile;
  unattributedPaise: number;
  onCreateAgreement?: () => void;
}) {
  if (profile.projects.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No agreements"
        description="Set up this contractor's commercial arrangement on a project — the agreed value, the labour types it covers and their rates, and the milestones that earn it."
        action={<CreateAgreementButton onClick={onCreateAgreement} />}
      />
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-foreground-subtle">
          Each agreement is financially isolated — one&rsquo;s advance never settles
          another&rsquo;s liability.
        </p>
        <CreateAgreementButton onClick={onCreateAgreement} />
      </div>
      <UnattributedBanner paise={unattributedPaise} />
      {profile.projects.map((g) => (
        <div key={g.projectId} className="rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-4 py-2.5 text-sm font-semibold">
            {g.projectName}
          </div>
          <div className="divide-y divide-border">
            {g.contracts.map((c) => (
              <AgreementRow key={c.id} contract={c} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Reconciliation ─────────────────────────────────────────────────────── */

/** The authoritative commercial statement for one agreement. */
export function ReconciliationStatement({
  contract,
  labourAdvanceOutstandingPaise = 0,
}: {
  contract: Contract;
  labourAdvanceOutstandingPaise?: number;
}) {
  const r: AgreementReconciliation = contract.reconciliation;
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {contract.title}
          <span className="ml-2 text-xs font-normal text-foreground-subtle">
            {contract.projectName}
          </span>
        </h3>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px]", CONTRACT_STATUS_TONE[contract.status])}>
          {CONTRACT_STATUS_LABEL[contract.status]}
        </span>
      </div>

      <div className="divide-y divide-border">
        <Line label="Authorised contract value" paise={r.currentContractValuePaise} strong />
        {r.amendmentDeltaPaise !== 0 && (
          <Line
            label="Amendments"
            paise={r.amendmentDeltaPaise}
            note={`original ${r.originalContractValuePaise / 100}`}
          />
        )}
        <Line label="Earned till date" paise={r.earnedValuePaise} />
        <Line label="Settled attendance credit" paise={r.attendanceCreditPaise} />
        <Line label="Other financial credit" paise={r.otherPaymentCreditPaise} />
        <Line label="Total credited" paise={r.totalCreditedPaise} strong />
        <Line
          label="Currently due"
          paise={r.currentDuePaise}
          tone="text-warning-foreground"
          strong
        />
        <Line label="Ahead credit" paise={r.advanceCreditPaise} strong />
        <Line label="Remaining unearned work" paise={r.remainingUnearnedPaise} />
        <Line label="Overall contract balance" paise={r.overallBalancePaise} />
      </div>

      {(r.unsettledAttendancePaise > 0 || labourAdvanceOutstandingPaise > 0) && (
        <div className="mt-3 space-y-1 rounded-lg bg-surface-muted/50 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">
            Informational — not part of the statement above
          </p>
          {r.unsettledAttendancePaise > 0 && (
            <Line
              label="Labour recorded but not yet settled"
              paise={r.unsettledAttendancePaise}
              note="becomes credit when settled"
            />
          )}
          {labourAdvanceOutstandingPaise > 0 && (
            <Line
              label="Labour advance outstanding"
              paise={labourAdvanceOutstandingPaise}
              note="nets off a future settlement"
            />
          )}
        </div>
      )}
    </div>
  );
}

export function ReconciliationTab({
  profile,
  unattributedPaise,
  onCreateAgreement,
}: {
  profile: ContractorProfile;
  unattributedPaise: number;
  onCreateAgreement?: () => void;
}) {
  const contracts = profile.projects.flatMap((g) => g.contracts);
  if (contracts.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="Nothing to reconcile"
        description="Reconciliation compares what an agreement has earned against what it has been credited. Create one to see it."
        action={<CreateAgreementButton onClick={onCreateAgreement} />}
      />
    );
  }
  return (
    <div className="space-y-4">
      <UnattributedBanner paise={unattributedPaise} />
      {contracts.map((c) => (
        <ReconciliationStatement key={c.id} contract={c} />
      ))}
    </div>
  );
}

/* ── Payments / credits ─────────────────────────────────────────────────── */

/**
 * Four sources, each with its accounting meaning stated. They are genuinely
 * different instruments, and a row of unlabelled "payment" buttons would invite
 * the same money being recorded twice in two contexts.
 */
export function PaymentsTab({
  payments,
  settlements = [],
  settledAttendancePaise,
  labourAdvanceOutstandingPaise,
  onReverseSettlement,
}: {
  payments: ContractPaymentHistoryRow[];
  settlements?: SettlementRow[];
  settledAttendancePaise: number;
  labourAdvanceOutstandingPaise: number;
  /** Omitted when the viewer lacks contractors.settle_reverse. */
  onReverseSettlement?: (settlement: SettlementRow) => void;
}) {
  const live = payments.filter((p) => p.reversedAt == null);
  const reversed = payments.filter((p) => p.reversedAt != null);
  const liveSettlements = settlements.filter((s) => !s.reversedAt);
  const reversedSettlements = settlements.filter((s) => s.reversedAt);

  return (
    <div className="space-y-5">
      <Group
        title="Attendance settlements"
        meaning="Labour value recognised when a period was settled. This is the canonical recognition of attendance money — correcting one means reversing it, never editing it away."
      >
        {liveSettlements.length > 0 && (
          <div className="divide-y divide-border">
            {liveSettlements.map((s) => (
              <SettlementRowView key={s.id} settlement={s} onReverse={onReverseSettlement} />
            ))}
          </div>
        )}
        <div className="border-t border-border px-4 py-3 text-sm first:border-t-0">
          <Line label="Settled labour credited to agreements" paise={settledAttendancePaise} />
        </div>
      </Group>

      <Group
        title="Agreement payments"
        meaning="Direct commercial payment against an agreement. Credits it immediately — reducing Currently Due, or creating Ahead Credit when it exceeds earned value."
      >
        {live.length === 0 ? (
          <p className="px-4 py-3 text-sm text-foreground-subtle">No payments recorded.</p>
        ) : (
          <PaymentRows rows={live} />
        )}
      </Group>

      <Group
        title="Labour advances"
        meaning="Cash pre-paying future labour. Nets off a future settlement — NOT agreement credit until that labour is settled."
      >
        <div className="px-4 py-3 text-sm">
          <Line label="Outstanding labour advance" paise={labourAdvanceOutstandingPaise} />
        </div>
      </Group>

      {(reversed.length > 0 || reversedSettlements.length > 0) && (
        <Group
          title="Reversals"
          meaning="Kept for audit and never deleted. These contribute to no total; the cash they paid out lives on as an unapplied advance."
        >
          {reversedSettlements.length > 0 && (
            <div className="divide-y divide-border">
              {reversedSettlements.map((s) => (
                <SettlementRowView key={s.id} settlement={s} />
              ))}
            </div>
          )}
          {reversed.length > 0 && <PaymentRows rows={reversed} reversed />}
        </Group>
      )}
    </div>
  );
}

/** One weekly settlement. A reversed one stays listed, struck through. */
function SettlementRowView({
  settlement: s,
  onReverse,
}: {
  settlement: SettlementRow;
  onReverse?: (s: SettlementRow) => void;
}) {
  const isReversed = !!s.reversedAt;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <span className={cn("font-medium", isReversed && "text-foreground-subtle line-through")}>
          {formatDate(s.periodStart)} – {formatDate(s.periodEnd)}
        </span>
        <span className="ml-2 text-xs text-foreground-subtle">{s.projectName}</span>
        <p className="mt-0.5 text-xs text-foreground-subtle">
          Bill <MoneyText paise={s.labourBillPaise} /> · advance adjusted{" "}
          <MoneyText paise={s.advanceAdjustmentPaise} /> · paid{" "}
          <MoneyText paise={s.netPaymentPaise} />
        </p>
        {isReversed && s.reversalReason && (
          <p className="mt-0.5 text-xs text-danger-foreground">Reversed: {s.reversalReason}</p>
        )}
      </div>
      {!isReversed && onReverse && (
        <button
          type="button"
          onClick={() => onReverse(s)}
          className="rounded-md border border-border px-2 py-1 text-xs text-foreground-muted transition-colors hover:bg-surface-muted"
        >
          Reverse
        </button>
      )}
    </div>
  );
}

function Group({
  title,
  meaning,
  children,
}: {
  title: string;
  meaning: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-4 py-2.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-foreground-subtle">{meaning}</p>
      </div>
      {children}
    </div>
  );
}

function PaymentRows({
  rows,
  reversed,
}: {
  rows: ContractPaymentHistoryRow[];
  reversed?: boolean;
}) {
  return (
    <div className="divide-y divide-border">
      {rows.map((p) => (
        <div
          key={p.id}
          className={cn(
            "flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm",
            reversed && "text-foreground-subtle line-through",
          )}
        >
          <div className="min-w-0">
            <span className="font-medium">{PAYMENT_TYPE_LABEL[p.type]}</span>
            <span className="ml-2 text-xs text-foreground-subtle">
              {formatDate(p.date)} · {p.contractTitle} · {p.projectName} ·{" "}
              {PAYMENT_MODE_LABEL[p.paymentMode]}
            </span>
            {reversed && p.reversalReason && (
              <p className="text-xs no-underline">Reversed: {p.reversalReason}</p>
            )}
          </div>
          <MoneyText paise={p.amountPaise} className="font-mono" />
        </div>
      ))}
    </div>
  );
}
