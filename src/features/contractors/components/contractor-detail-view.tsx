"use client";

import * as React from "react";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Info,
  Plus,
  Pencil,
  Wallet,
  Receipt,
  Download,
  FileSignature,
  MoreHorizontal,
} from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { Callout } from "@/components/patterns/callout";
import { Badge } from "@/components/ui/badge";
import { RowsSkeleton } from "@/components/patterns/loading-state";
import { MoneyText } from "@/components/patterns/money-text";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { RecordNav, type RecordNavGroup } from "@/components/patterns/record-nav";
import { cn } from "@/lib/utils";
import { formatDate } from "@/features/projects/format";
import { useCan } from "@/features/rbac/permission-context";
import { useContractorProfile } from "@/features/contracts/hooks";
import {
  AgreementsTab,
  OverviewTab,
  PaymentsTab,
  ReconciliationTab,
} from "@/features/contracts/components/command-centre";
import {
  AmendmentsTab,
  HistoryTab,
  MilestonesTab,
  RatesTab,
  ScopeTab,
} from "@/features/contracts/components/command-centre-tabs";
import {
  useArchiveContractor,
  useContractorLedger,
  useRestoreContractor,
  useReverseSettlement,
  useSettlements,
} from "../hooks";
import type {
  ContractorLedger as ContractorLedgerDto,
  ContractorLedgerEntry as ContractorLedgerEntryDto,
  ContractorLedgerType,
  ContractorSettlement,
} from "../types";
import { ContractFormSheet } from "@/features/contracts/components/contract-form-sheet";
import { AgreementActionsMenu } from "@/features/contracts/components/agreement-actions-menu";
import { ReverseContractPaymentDialog } from "@/features/contracts/components/payment-actions";
import type { ContractPaymentHistoryRow } from "@/features/contracts/types";
import { AddContractorSheet } from "./add-contractor-sheet";
import { RecordAdvanceSheet } from "./record-advance-sheet";
import { DataTable } from "@/components/patterns/data-table";
import { RescopeAdvanceSheet } from "./rescope-advance-sheet";
import { ReverseRescopeDialog } from "./reverse-rescope-dialog";
import { outstandingPerAdvance } from "../calc";
import { SettlementSheet } from "./settlement-sheet";

const TYPE_LABEL: Record<ContractorLedgerType, string> = {
  OPENING_ADVANCE: "Opening advance",
  ADVANCE: "Advance paid",
  LABOUR_BILL: "Labour bill",
  ADJUSTMENT: "Advance adjusted",
  PAYMENT: "Payment made",
  SETTLEMENT_REVERSAL: "Settlement reversed",
  // Rendered as ONE logical row by the ledger (see AdvanceLedgerTab): showing
  // "Advance adjusted −₹2L" beside "Advance paid +₹2L" would read as cash
  // leaving and arriving, which is exactly what a re-scope is not.
  SCOPE_TRANSFER_OUT: "Advance re-scoped",
  SCOPE_TRANSFER_IN: "Advance re-scoped",
};
const TYPE_SIGN: Record<ContractorLedgerType, string> = {
  OPENING_ADVANCE: "+",
  ADVANCE: "+",
  ADJUSTMENT: "−",
  // A transfer moves no money in or out — it is shown without a sign.
  SCOPE_TRANSFER_OUT: "",
  SCOPE_TRANSFER_IN: "",
  LABOUR_BILL: "",
  PAYMENT: "",
  SETTLEMENT_REVERSAL: "+",
};
const TYPE_TONE: Record<ContractorLedgerType, string> = {
  OPENING_ADVANCE: "text-foreground",
  ADVANCE: "text-foreground",
  ADJUSTMENT: "text-warning-foreground",
  LABOUR_BILL: "text-foreground-muted",
  PAYMENT: "text-success-foreground",
  SETTLEMENT_REVERSAL: "text-warning-foreground",
  SCOPE_TRANSFER_OUT: "text-foreground-muted",
  SCOPE_TRANSFER_IN: "text-foreground-muted",
};

export function ContractorDetailView({ contractorId }: { contractorId: string }) {
  const can = useCan();
  const { data, isLoading } = useContractorLedger(contractorId);
  const { data: headerProfile } = useContractorProfile(contractorId);
  const [editOpen, setEditOpen] = React.useState(false);
  const [advanceOpen, setAdvanceOpen] = React.useState(false);
  const [settleOpen, setSettleOpen] = React.useState(false);
  const [agreementOpen, setAgreementOpen] = React.useState(false);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  // Bumped when an agreement is created, so the command centre can jump to it.
  const [createdAt, setCreatedAt] = React.useState(0);

  if (isLoading) {
    return (
      <div className="space-y-5">
        <BackLink />
        <RowsSkeleton rows={8} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-5">
        <BackLink />
        <EmptyState icon={Wallet} title="Contractor not found" description="It may have been removed." />
      </div>
    );
  }

  const { contractor } = data;
  // Affordances follow the SAME permission each server action demands — the
  // module used to gate these on `role === "OWNER"`, which meant an Accountant
  // holding contractors.advance / contractors.settle (the role that exists
  // precisely to move contractor cash) could see no button at all.
  const canCreateAgreement = can("contracts.create");
  const canAdvance = can("contractors.advance");
  const canSettle = can("contractors.settle");
  const canEdit = can("contractors.edit");
  const archived = contractor.status === "INACTIVE";
  const canArchive = can("contractors.archive") && !archived;
  const canRestore = can("contractors.restore") && archived;
  const hasActions =
    canCreateAgreement || canAdvance || canSettle || canEdit || canArchive || canRestore;

  const projectCount = headerProfile?.projects.length ?? 0;
  // Same query the command centre reads, so React Query serves it from cache
  // rather than issuing a second request.
  const unsettledPaise = headerProfile?.lifetime.totalUnsettledAttendancePaise ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <>
            <span className="truncate">{contractor.name}</span>
            <Badge variant={archived ? "neutral" : "success"}>{archived ? "Archived" : "Active"}</Badge>
          </>
        }
        meta={
          <>
            <span>{contractor.phone || "No mobile on file"}</span>
            {projectCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {projectCount} {projectCount === 1 ? "project" : "projects"}
                </span>
              </>
            )}
          </>
        }
        actions={
          hasActions ? (
            <ContractorActions
              archived={archived}
              canCreateAgreement={canCreateAgreement}
              canAdvance={canAdvance}
              canSettle={canSettle}
              canEdit={canEdit}
              canArchive={canArchive}
              canRestore={canRestore}
              onCreateAgreement={() => setAgreementOpen(true)}
              onAdvance={() => setAdvanceOpen(true)}
              onSettle={() => setSettleOpen(true)}
              onEdit={() => setEditOpen(true)}
              onArchive={() => setArchiveOpen(true)}
            />
          ) : undefined
        }
      />

      {/* The headline position, immediately under the name — the two figures a
          user opens this record to see, rather than six equal tiles further
          down the page. NEVER amber merely for being money: the advance balance
          is a neutral fact, so it is toned like one. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard
          label={data.scope === "COMPANY" ? "Advance balance" : "Visible project advance balance"}
          value={<MoneyText paise={contractor.advanceBalancePaise} />}
          hint={
            data.scope === "PROJECT"
              ? "Across your projects only — the company-wide position needs the view-all-projects permission."
              : "Cash pre-paying future labour. It becomes agreement credit only when that labour is settled."
          }
        />
        <StatCard
          label="Unsettled labour"
          value={<MoneyText paise={unsettledPaise} />}
          hint="Attendance recorded but not yet settled. Informational — it is not credit yet."
          tone={unsettledPaise > 0 ? "attention" : "neutral"}
        />
      </div>

      {archived && (
        <Callout tone="neutral" title="This contractor is archived">
          Everything already recorded stays exactly as it is and remains fully readable — they
          simply can&rsquo;t take on new agreements, advances, attendance or projects until
          restored. Closing out what they already did stays available: work recorded before
          archiving can still be settled, and settlements, payments and agreements can still be
          reversed, amended or corrected.
        </Callout>
      )}

      <CommandCentre
        contractorId={contractor.id}
        ledger={data}
        // Withheld while archived: the server refuses a new agreement for an
        // archived contractor, so the tabs offer nothing that would 403.
        onCreateAgreement={
          canCreateAgreement && !archived ? () => setAgreementOpen(true) : undefined
        }
        agreementCreatedAt={createdAt}
      />

      <AddContractorSheet open={editOpen} onOpenChange={setEditOpen} contractor={contractor} />
      {archiveOpen && (
        <ArchiveContractorDialog
          contractor={contractor}
          balancePaise={data.scope === "COMPANY" ? contractor.advanceBalancePaise : null}
          onOpenChange={(o) => !o && setArchiveOpen(false)}
        />
      )}
      <RecordAdvanceSheet
        open={advanceOpen}
        onOpenChange={setAdvanceOpen}
        contractorId={contractor.id}
        contractorName={contractor.name}
      />
      <SettlementSheet
        open={settleOpen}
        onOpenChange={setSettleOpen}
        contractorId={contractor.id}
        contractorName={contractor.name}
      />
      {/* The SAME creation workflow the project side uses — one agreement model,
          reached from wherever the user happens to be. */}
      <ContractFormSheet
        open={agreementOpen}
        onOpenChange={setAgreementOpen}
        contractorId={contractor.id}
        onCreated={() => setCreatedAt(Date.now())}
      />
    </div>
  );
}

/**
 * The commercial workspace: everything about this contractor, grouped so each
 * tab answers one question.
 *
 * The advance ledger keeps its own tab rather than merging into Payments —
 * a labour advance and an agreement payment are different instruments (one
 * pre-pays labour and nets off a settlement, the other credits an agreement
 * immediately), and blurring them is exactly how the same money gets recorded
 * twice.
 */
/** Every section the record exposes — the allow-list a `?section=` deep link is
 *  checked against, so a bad or stale value can never blank the panel. */
const SECTION_VALUES = [
  "overview",
  "agreements",
  "scope",
  "rates",
  "milestones",
  "amendments",
  "payments",
  "reconciliation",
  "ledger",
  "history",
] as const;

function CommandCentre({
  contractorId,
  ledger,
  onCreateAgreement,
  agreementCreatedAt,
}: {
  contractorId: string;
  ledger: ContractorLedgerDto;
  onCreateAgreement?: () => void;
  /** Changes when an agreement is created; reveals it instead of leaving the
   *  user on the empty Overview wondering whether it saved. */
  agreementCreatedAt: number;
}) {
  const can = useCan();
  const canSeeAgreements = can("contracts.view");
  // Without `contracts.view` the record is just the advance ledger, so that has
  // to be the landing section — defaulting to a section with no nav entry left
  // the panel blank.
  // A deep link may name the section, so "Open source" from the Payments Centre
  // lands on the money rather than on Overview. Read once, at mount: after that
  // the tab strip owns the value, and a stale query string must not fight it.
  const [tab, setTab] = React.useState(() => {
    const wanted =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("section")
        : null;
    const allowed = canSeeAgreements ? SECTION_VALUES : (["ledger"] as const);
    if (wanted && (allowed as readonly string[]).includes(wanted)) return wanted;
    return canSeeAgreements ? "overview" : "ledger";
  });
  const { data: profile } = useContractorProfile(contractorId);

  const [seenCreatedAt, setSeenCreatedAt] = React.useState(agreementCreatedAt);
  if (seenCreatedAt !== agreementCreatedAt) {
    setSeenCreatedAt(agreementCreatedAt);
    setTab("agreements");
  }
  const { data: settlements = [] } = useSettlements({ contractorId });
  const [reversing, setReversing] = React.useState<ContractorSettlement | null>(null);
  const [reversingPayment, setReversingPayment] =
    React.useState<ContractPaymentHistoryRow | null>(null);

  const contracts = profile?.projects.flatMap((g) => g.contracts) ?? [];

  // Affordance gates only — every server action re-checks the same permission.
  const canActOnAgreements =
    can("contracts.edit") ||
    can("contracts.complete") ||
    can("contracts.cancel") ||
    can("contracts.delete") ||
    can("contracts.pay");

  // The AUTHORITATIVE outstanding advance — the server's unscoped fold, the same
  // figure the settlement allocator draws against. Folding `ledger.entries` here
  // would silently reproduce the partial-balance bug for any viewer who cannot
  // see every entry.
  const labourAdvanceOutstandingPaise = ledger.contractor.advanceBalancePaise;
  const settledAttendancePaise = contracts.reduce(
    (acc, c) => acc + c.reconciliation.attendanceCreditPaise,
    0,
  );

  // Grouped by the QUESTION each section answers, which is what stops ten peers
  // reading as an undifferentiated row: what is the commercial arrangement,
  // where is the money, and what happened.
  const navGroups: RecordNavGroup[] = canSeeAgreements
    ? [
        { label: "Summary", items: [{ value: "overview", label: "Overview" }] },
        {
          label: "Commercial",
          items: [
            { value: "agreements", label: "Agreements" },
            { value: "scope", label: "Scope & Labour" },
            { value: "rates", label: "Rates" },
            { value: "milestones", label: "Milestones" },
            { value: "amendments", label: "Amendments" },
          ],
        },
        {
          label: "Money",
          items: [
            { value: "payments", label: "Payments" },
            { value: "reconciliation", label: "Reconciliation" },
            { value: "ledger", label: "Advance ledger" },
          ],
        },
        { label: "Audit", items: [{ value: "history", label: "History" }] },
      ]
    : [{ label: "Money", items: [{ value: "ledger", label: "Advance ledger" }] }];

  return (
    <>
      <Tabs
        value={tab}
        onValueChange={setTab}
        orientation="vertical"
        className="lg:flex lg:items-start lg:gap-8"
      >
        <RecordNav
          groups={navGroups}
          value={tab}
          onValueChange={setTab}
          label="Contractor sections"
          className="lg:sticky lg:top-20"
        />
        <div className="min-w-0 flex-1">

        {canSeeAgreements && profile && (
          <>
            <TabsContent value="overview" className="pt-4">
              <OverviewTab profile={profile} onCreateAgreement={onCreateAgreement} />
            </TabsContent>
            <TabsContent value="agreements" className="pt-4">
              <AgreementsTab
                profile={profile}
                onCreateAgreement={onCreateAgreement}
                renderActions={
                  canActOnAgreements
                    ? (contract) => <AgreementActionsMenu contract={contract} />
                    : undefined
                }
              />
            </TabsContent>
            <TabsContent value="scope" className="pt-4">
              <ScopeTab
                contracts={contracts}
                onCreateAgreement={onCreateAgreement}
                canEditScope={can("contracts.edit")}
              />
            </TabsContent>
            <TabsContent value="rates" className="pt-4">
              <RatesTab contracts={contracts} onCreateAgreement={onCreateAgreement} />
            </TabsContent>
            <TabsContent value="milestones" className="pt-4">
              <MilestonesTab contracts={contracts} onCreateAgreement={onCreateAgreement} />
            </TabsContent>
            <TabsContent value="amendments" className="pt-4">
              <AmendmentsTab contracts={contracts} onCreateAgreement={onCreateAgreement} />
            </TabsContent>
            <TabsContent value="payments" className="pt-4">
              <PaymentsTab
                payments={profile.payments}
                settlements={settlements}
                settledAttendancePaise={settledAttendancePaise}
                labourAdvanceOutstandingPaise={labourAdvanceOutstandingPaise}
                onReverseSettlement={
                  can("contractors.settle_reverse")
                    ? (s) => setReversing(s as ContractorSettlement)
                    : undefined
                }
                payableContracts={can("contracts.pay") ? contracts : undefined}
                onReversePayment={
                  can("contracts.pay_delete") ? (p) => setReversingPayment(p) : undefined
                }
              />
            </TabsContent>
            <TabsContent value="reconciliation" className="pt-4">
              <ReconciliationTab profile={profile} onCreateAgreement={onCreateAgreement} />
            </TabsContent>
            <TabsContent value="history" className="pt-4">
              <HistoryTab contractorId={contractorId} />
            </TabsContent>
          </>
        )}

        <TabsContent value="ledger" className="pt-4">
          <AdvanceLedgerTab ledger={ledger} />
        </TabsContent>
        </div>
      </Tabs>

      <ReverseSettlementDialog
        settlement={reversing}
        onOpenChange={(o) => !o && setReversing(null)}
      />
      {/* An agreement payment and a settlement are different instruments, so the
          two reversals are different flows — neither is an undo of the other. */}
      <ReverseContractPaymentDialog
        payment={reversingPayment}
        onOpenChange={(o) => !o && setReversingPayment(null)}
      />
    </>
  );
}

/**
 * Reversing a settlement is a governed correction, not an undo: it un-recognises
 * the labour, restores every drawdown to the advance it came from, and turns the
 * cash already paid into an unapplied advance. Nothing is deleted, and a reason
 * is mandatory — this is the audit trail for money that has left the bank.
 */
function ReverseSettlementDialog({
  settlement,
  onOpenChange,
}: {
  settlement: ContractorSettlement | null;
  onOpenChange: (open: boolean) => void;
}) {
  if (!settlement) return null;
  // The form is mounted only while the dialog is open, so the reason field
  // starts empty each time without an effect resetting it.
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <ReverseSettlementForm settlement={settlement} onOpenChange={onOpenChange} />
    </Dialog>
  );
}

function ReverseSettlementForm({
  settlement,
  onOpenChange,
}: {
  settlement: ContractorSettlement;
  onOpenChange: (open: boolean) => void;
}) {
  const reverse = useReverseSettlement();
  const [reason, setReason] = React.useState("");

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Reverse this settlement?</DialogTitle>
        <DialogDescription>
          {formatDate(settlement.periodStart)} – {formatDate(settlement.periodEnd)} ·{" "}
          {settlement.projectName}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 text-sm">
        <p className="text-foreground-muted">
          The settlement stays on record, struck through. Its{" "}
          <MoneyText paise={settlement.advanceAdjustmentPaise} /> drawdown returns to the advance it
          came from, and the <MoneyText paise={settlement.netPaymentPaise} />{" "}
          already paid becomes an unapplied advance — the contractor is still holding it. The
          period&rsquo;s attendance becomes editable again.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="reversal-reason">Reason</Label>
          <Input
            id="reversal-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Wrong headcount recorded on Friday"
            autoFocus
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={!reason.trim() || reverse.isPending}
          onClick={() =>
            reverse.mutate(
              { id: settlement.id, reason: reason.trim() },
              { onSuccess: () => onOpenChange(false) },
            )
          }
        >
          Reverse settlement
        </Button>
      </div>
    </DialogContent>
  );
}

/**
 * The contractor-level advance ledger, kept visible and clearly distinguished
 * from agreement payments. Scoped advances name the agreement they belong to;
 * unattributed ones say so, because they carry no project or agreement claim.
 *
 * The balance column is the HISTORICAL footprint each entry recorded when it was
 * written — a reversal appends later entries and deliberately does not rewrite
 * it. The CURRENT balance is always the fold, shown in the header above.
 */
/** The visible rows, as the DTO carries them. */
const entriesOf = (l: ContractorLedgerDto) => l.entries;

/**
 * How a row's scope reads. An agreement names BOTH project and agreement,
 * because "Structure" alone is ambiguous across projects and the scope is what
 * decides which labour may draw on the money.
 */
function scopeLabelOf(e: ContractorLedgerEntryDto): string {
  if (e.contractTitle) return e.projectName ? `${e.projectName} · ${e.contractTitle}` : e.contractTitle;
  return e.projectName ?? "General contractor advance";
}

/**
 * How a ledger row's scope reads. A re-scope is a MOVE, so it names both ends —
 * showing it as a scope of its own would hide the very thing that changed.
 */
function ScopeCell({
  entry,
  inByOut,
}: {
  entry: ContractorLedgerEntryDto;
  inByOut: Map<string, ContractorLedgerEntryDto>;
}) {
  if (entry.type !== "SCOPE_TRANSFER_OUT") return <>{scopeLabelOf(entry)}</>;
  const target = inByOut.get(entry.id);
  return (
    <>
      {scopeLabelOf(entry)} <span className="text-foreground-subtle">&rarr;</span>{" "}
      {target ? scopeLabelOf(target) : "—"}
    </>
  );
}

/** Re-scope, and its undo — both gated on `contractors.advance_rescope`. */
function LedgerRowActions({
  entry,
  canRescope,
  rescopable,
  reversible,
  onRescope,
  onReverse,
}: {
  entry: ContractorLedgerEntryDto;
  canRescope: boolean;
  /** Rows that still hold movable money, by the allocator's own rule. */
  rescopable: Set<string>;
  /** Transfers the server would still accept a reversal for. */
  reversible: Set<string>;
  onRescope: (e: ContractorLedgerEntryDto) => void;
  onReverse: (e: ContractorLedgerEntryDto) => void;
}) {
  if (!canRescope) return null;
  return (
    <span className="flex items-center justify-end gap-2 font-sans text-xs">
      {rescopable.has(entry.id) && (
        <button
          type="button"
          onClick={() => onRescope(entry)}
          className="rounded-sm text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Re-scope
        </button>
      )}
      {/* Undo, on the transfer row itself — where a reader who has just
          understood the move is standing. The server refuses if the moved money
          has since been spent. */}
      {reversible.has(entry.id) && (
        <button
          type="button"
          onClick={() => onReverse(entry)}
          className="rounded-sm text-foreground-muted transition-colors hover:text-danger-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Reverse
        </button>
      )}
    </span>
  );
}

function AdvanceLedgerTab({ ledger }: { ledger: ContractorLedgerDto }) {
  const can = useCan();
  // Re-scoping can BROADEN the reach of money already handed over, so it has its
  // own danger permission. Everyone else still sees the ledger and the scopes.
  const canRescope = can("contractors.advance_rescope");
  const [rescoping, setRescoping] = React.useState<ContractorLedgerEntryDto | null>(null);
  const [reversingTransfer, setReversingTransfer] =
    React.useState<ContractorLedgerEntryDto | null>(null);

  // A transfer is written as an OUT/IN PAIR so the balance nets to zero. Shown
  // as ONE row: "Advance adjusted −₹2L" beside "Advance paid +₹2L" would read as
  // cash leaving and arriving, which is exactly what a re-scope is not. The
  // underlying rows are untouched — this is presentation only, and every
  // calculation still folds both.
  const inByOut = new Map(
    entriesOf(ledger)
      .filter((e) => e.type === "SCOPE_TRANSFER_IN" && e.drawsFromEntryId)
      .map((e) => [e.drawsFromEntryId!, e]),
  );
  const entries = entriesOf(ledger).filter((e) => e.type !== "SCOPE_TRANSFER_IN");

  // Which transfers can still be undone. Mirrors the server's two refusals
  // exactly — this decides only whether the ACTION is offered; the server
  // re-checks and is the authority.
  //
  //   1. A transfer whose OUT draws from another transfer's IN *is* a reversal.
  //      Offering "Reverse" on it would read as undoing an undo, when it would
  //      really re-apply the original move.
  //   2. A transfer already reversed cannot be reversed twice
  //      (TRANSFER_ALREADY_REVERSED).
  const byId = new Map(entriesOf(ledger).map((e) => [e.id, e]));
  const reversedOutIds = new Set(
    entriesOf(ledger)
      .filter((e) => e.type === "SCOPE_TRANSFER_OUT" && e.drawsFromEntryId)
      .map((e) => byId.get(e.drawsFromEntryId!))
      .filter((src) => src?.type === "SCOPE_TRANSFER_IN")
      .map((inRow) => inRow!.drawsFromEntryId!)
      .filter(Boolean),
  );
  const reversible = new Set(
    entriesOf(ledger)
      .filter(
        (e) =>
          e.type === "SCOPE_TRANSFER_OUT" &&
          byId.get(e.drawsFromEntryId ?? "")?.type !== "SCOPE_TRANSFER_IN" &&
          !reversedOutIds.has(e.id),
      )
      .map((e) => e.id),
  );

  // Rows that still hold movable money. Computed from the same rule the server
  // and the allocator use, so the action never appears on money that cannot move.
  const rescopable = new Set(
    outstandingPerAdvance(
      entriesOf(ledger).map((e) => ({
        id: e.id,
        type: e.type,
        amountPaise: e.amountPaise,
        projectId: e.projectId,
        contractId: e.contractId,
        drawsFromEntryId: e.drawsFromEntryId,
        reversesEntryId: e.reversesEntryId,
        date: e.date,
      })),
    )
      .filter((a) => a.remainingPaise > 0)
      .map((a) => a.entryId),
  );
  if (entries.length === 0) {
    return (
      <div className="space-y-3">
        <PartialLedgerNote ledger={ledger} />
        <EmptyState
          icon={Plus}
          title={ledger.isPartial ? "No ledger entries on your projects" : "No ledger entries"}
          description="Record a labour advance or a weekly settlement to start the ledger."
        />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <PartialLedgerNote ledger={ledger} />
      <div className="flex items-center justify-between">
        <p className="text-xs text-foreground-subtle">
          A labour advance pre-pays future labour and nets off a settlement. It is not agreement
          credit until that labour is settled.
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm">
              <Download className="size-4" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={async () => (await import("../exports")).exportLedgerExcel(ledger)}
            >
              Excel
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => (await import("../exports")).exportLedgerPdf(ledger)}
            >
              PDF
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {rescoping && (
        <RescopeAdvanceSheet
          open
          onOpenChange={(o: boolean) => !o && setRescoping(null)}
          contractorId={ledger.contractor.id}
          contractorName={ledger.contractor.name}
          advance={rescoping}
        />
      )}
      <ReverseRescopeDialog
        transfer={reversingTransfer}
        fromLabel={reversingTransfer ? scopeLabelOf(reversingTransfer) : ""}
        toLabel={
          reversingTransfer && inByOut.get(reversingTransfer.id)
            ? scopeLabelOf(inByOut.get(reversingTransfer.id)!)
            : "its new scope"
        }
        onOpenChange={(o) => !o && setReversingTransfer(null)}
      />
      <DataTable
        caption="Advance ledger entries"
        rows={entries}
        getRowKey={(e) => e.id}
        columns={[
          {
            key: "date",
            header: "Date",
            cell: (e) => (
              <span className="whitespace-nowrap text-foreground-muted">{formatDate(e.date)}</span>
            ),
          },
          {
            key: "entry",
            header: "Entry",
            cell: (e) => (
              <div className="min-w-40">
                <span className={cn("whitespace-nowrap font-medium", TYPE_TONE[e.type])}>
                  {TYPE_LABEL[e.type]}
                </span>
                {(e.notes || e.projectName) && (
                  <span className="ml-1 text-xs text-foreground-subtle">
                    · {e.notes || e.projectName}
                  </span>
                )}
              </div>
            ),
          },
          {
            key: "scope",
            header: "Scope",
            // The rail costs ~224px, so the scope column only earns its place
            // once the viewport is genuinely wide.
            hideBelow: "xl",
            cell: (e) => <ScopeCell entry={e} inByOut={inByOut} />,
          },
          {
            key: "amount",
            header: "Amount",
            numeric: true,
            cell: (e) => (
              <span className={TYPE_TONE[e.type]}>
                {TYPE_SIGN[e.type]}
                <MoneyText paise={e.amountPaise} />
              </span>
            ),
          },
          {
            key: "balance",
            header: "Balance after",
            numeric: true,
            hideBelow: "lg",
            cell: (e) =>
              e.type === "SCOPE_TRANSFER_OUT" ? (
                <span className="font-sans text-xs text-foreground-subtle">No cash moved</span>
              ) : (
                <span className="text-foreground-muted">
                  <MoneyText paise={e.advanceBalanceAfterPaise} />
                </span>
              ),
          },
          {
            key: "actions",
            header: "Actions",
            headerHidden: true,
            numeric: true,
            cell: (e) => (
              <LedgerRowActions
                entry={e}
                canRescope={canRescope}
                rescopable={rescopable}
                reversible={reversible}
                onRescope={setRescoping}
                onReverse={setReversingTransfer}
              />
            ),
          },
        ]}
        renderCard={(e) => (
          <div className="rounded-xl border border-border bg-surface p-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className={cn("min-w-0 font-medium", TYPE_TONE[e.type])}>
                {TYPE_LABEL[e.type]}
              </span>
              <span className={cn("shrink-0 font-mono tabular-nums", TYPE_TONE[e.type])}>
                {TYPE_SIGN[e.type]}
                <MoneyText paise={e.amountPaise} />
              </span>
            </div>
            <p className="mt-1 text-xs text-foreground-muted">{formatDate(e.date)}</p>
            <p className="mt-1 text-xs text-foreground-subtle">
              <ScopeCell entry={e} inByOut={inByOut} />
            </p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-xs text-foreground-subtle">
                {e.type === "SCOPE_TRANSFER_OUT" ? (
                  "No cash moved"
                ) : (
                  <>
                    Balance after <MoneyText paise={e.advanceBalanceAfterPaise} />
                  </>
                )}
              </span>
              <LedgerRowActions
                entry={e}
                canRescope={canRescope}
                rescopable={rescopable}
                reversible={reversible}
                onRescope={setRescoping}
                onReverse={setReversingTransfer}
              />
            </div>
          </div>
        )}
      />
    </div>
  );
}

/**
 * Says why the rows below may not add up to the headline balance.
 *
 * A caller without `contractors.view_all` / `projects.view_all` sees only ledger
 * entries on projects they can access; company-wide advances carry no project and
 * are not theirs to inspect. The balance above is still the real one, so the
 * arithmetic must be explained rather than left to look broken.
 *
 * Deliberately discloses only a COUNT — no amount, project, agreement, actor,
 * date or reason from a hidden entry reaches this component.
 */
function PartialLedgerNote({ ledger }: { ledger: ContractorLedgerDto }) {
  if (!ledger.isPartial) return null;
  return (
    <div className="flex gap-2.5 rounded-lg border border-border bg-surface-muted/50 px-3 py-2.5 text-xs text-foreground-muted">
      <Info className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
      <p>
        You are seeing ledger entries for your projects only.{" "}
        <strong className="font-medium text-foreground">
          {ledger.hiddenEntryCount} further {ledger.hiddenEntryCount === 1 ? "entry" : "entries"}
        </strong>{" "}
        on other projects or held company-wide are included in the advance balance above but are
        not listed here, so these rows will not add up to it.
      </p>
    </div>
  );
}

/**
 * Archive / restore.
 *
 * Archiving is deliberately NOT a delete and the copy says so plainly: every
 * agreement, settlement, payment and attendance row stays, and closing it out —
 * settling attendance already recorded, reversing, amending, correcting — stays
 * available. What stops is new work, attendance included. An outstanding advance
 * is surfaced rather than used to block — money the contractor is holding is a
 * reason to think, not a reason the system should refuse, and archiving is
 * reversible in one click.
 *
 * The copy must not promise more than the server enforces, so it is written from
 * the same list the server checks (contractors/lifecycle.ts).
 */
function ArchiveContractorDialog({
  contractor,
  balancePaise,
  onOpenChange,
}: {
  contractor: ContractorLedgerDto["contractor"];
  /** Null when the viewer only sees a project-scoped figure. */
  balancePaise: number | null;
  onOpenChange: (o: boolean) => void;
}) {
  const archive = useArchiveContractor();
  const restore = useRestoreContractor();
  const archived = contractor.status === "INACTIVE";
  const pending = archive.isPending || restore.isPending;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {archived ? "Restore this contractor?" : "Archive this contractor?"}
          </DialogTitle>
          <DialogDescription>{contractor.name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm text-foreground-muted">
          {archived ? (
            <p>
              They can take on new work again — agreements, advances, attendance and project
              assignments. Nothing about their history changes.
            </p>
          ) : (
            <>
              <p>
                They stay in every historical agreement, settlement, payment, attendance record
                and report, and remain fully readable. What stops is new work: no new
                agreements, no new advances, no new attendance, and no new project assignments
                until they are restored.
              </p>
              <p className="text-xs">
                Closing out and correcting what they already did stays available — attendance
                already recorded can still be settled, a settlement or payment can still be
                reversed, an unsettled attendance row can still be corrected, and an agreement
                can still be amended or cancelled.
              </p>
              {balancePaise != null && balancePaise > 0 && (
                <div className="rounded-lg border border-warning/40 bg-warning-subtle/50 px-3 py-2 text-xs text-warning-foreground">
                  They are still holding <MoneyText paise={balancePaise} /> of outstanding
                  advance. Archiving does not settle or write that off — it stays on the ledger.
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={archived ? "primary" : "danger"}
            disabled={pending}
            onClick={() =>
              (archived ? restore : archive).mutate(contractor.id, {
                onSuccess: () => onOpenChange(false),
              })
            }
          >
            {pending ? "Saving…" : archived ? "Restore contractor" : "Archive contractor"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The contractor's action set, in priority order.
 *
 * Five buttons of equal weight is not a hierarchy — and at 375px they wrapped
 * into a ragged block where "Record labour advance" and "New settlement"
 * physically overlapped. So:
 *
 *   primary    settling recognises work already done and is the recurring act
 *   secondary  advance and agreement set up future work
 *   overflow   Edit, and the lifecycle actions
 *
 * Archive is destructive and rare, so it never sits inline beside routine
 * actions. Below `sm` everything except the primary collapses into the menu,
 * which is what removes the collision rather than papering over it.
 *
 * Each affordance is gated on the SAME permission its server action demands, so
 * an unavailable action is absent rather than present-and-refusing — and the
 * row closes up around it instead of leaving a gap.
 */
function ContractorActions({
  archived,
  canCreateAgreement,
  canAdvance,
  canSettle,
  canEdit,
  canArchive,
  canRestore,
  onCreateAgreement,
  onAdvance,
  onSettle,
  onEdit,
  onArchive,
}: {
  archived: boolean;
  canCreateAgreement: boolean;
  canAdvance: boolean;
  canSettle: boolean;
  canEdit: boolean;
  canArchive: boolean;
  canRestore: boolean;
  onCreateAgreement: () => void;
  onAdvance: () => void;
  onSettle: () => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  // Settlement stays available while ARCHIVED on purpose: it recognises
  // attendance already recorded, so withholding it would strand a real
  // liability. The server agrees — see contractors/lifecycle.ts.
  const showAdvance = canAdvance && !archived;
  const showAgreement = canCreateAgreement && !archived;
  const hasOverflow = canEdit || canArchive || canRestore || showAdvance || showAgreement;

  return (
    <>
      {canSettle && (
        <Button variant="primary" onClick={onSettle}>
          <Receipt />
          New settlement
        </Button>
      )}
      {showAdvance && (
        <Button variant="secondary" className="hidden sm:inline-flex" onClick={onAdvance}>
          <Wallet />
          Record advance
        </Button>
      )}
      {showAgreement && (
        <Button variant="secondary" className="hidden md:inline-flex" onClick={onCreateAgreement}>
          <FileSignature />
          Create agreement
        </Button>
      )}
      {hasOverflow && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="More contractor actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {showAdvance && (
              <DropdownMenuItem className="sm:hidden" onSelect={onAdvance}>
                <Wallet />
                Record advance
              </DropdownMenuItem>
            )}
            {showAgreement && (
              <DropdownMenuItem className="md:hidden" onSelect={onCreateAgreement}>
                <FileSignature />
                Create agreement
              </DropdownMenuItem>
            )}
            {canEdit && (
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil />
                Edit details
              </DropdownMenuItem>
            )}
            {(canArchive || canRestore) && canEdit && <DropdownMenuSeparator />}
            {canArchive && (
              <DropdownMenuItem onSelect={onArchive} className="text-danger-foreground">
                <Archive />
                Archive contractor
              </DropdownMenuItem>
            )}
            {canRestore && (
              <DropdownMenuItem onSelect={onArchive}>
                <ArchiveRestore />
                Restore contractor
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}

function BackLink() {
  return (
    <Link
      href="/labor/contractors"
      className="inline-flex items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      Contractors
    </Link>
  );
}
