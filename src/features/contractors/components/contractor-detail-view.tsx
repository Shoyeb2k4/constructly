"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Wallet,
  Receipt,
  Download,
  FileSignature,
} from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  HistoryTab,
  MilestonesTab,
  RatesTab,
  ScopeTab,
} from "@/features/contracts/components/command-centre-tabs";
import { useContractorLedger, useReverseSettlement, useSettlements } from "../hooks";
import { advanceDeltaPaise } from "../calc";
import type {
  ContractorLedger as ContractorLedgerDto,
  ContractorLedgerType,
  ContractorSettlement,
} from "../types";
import { ContractFormSheet } from "@/features/contracts/components/contract-form-sheet";
import { AddContractorSheet } from "./add-contractor-sheet";
import { RecordAdvanceSheet } from "./record-advance-sheet";
import { SettlementSheet } from "./settlement-sheet";

const TYPE_LABEL: Record<ContractorLedgerType, string> = {
  OPENING_ADVANCE: "Opening advance",
  ADVANCE: "Advance paid",
  LABOUR_BILL: "Labour bill",
  ADJUSTMENT: "Advance adjusted",
  PAYMENT: "Payment made",
  SETTLEMENT_REVERSAL: "Settlement reversed",
};
const TYPE_SIGN: Record<ContractorLedgerType, string> = {
  OPENING_ADVANCE: "+",
  ADVANCE: "+",
  ADJUSTMENT: "−",
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
};

export function ContractorDetailView({
  contractorId,
  isOwner,
}: {
  contractorId: string;
  isOwner: boolean;
}) {
  const can = useCan();
  const { data, isLoading } = useContractorLedger(contractorId);
  const [editOpen, setEditOpen] = React.useState(false);
  const [advanceOpen, setAdvanceOpen] = React.useState(false);
  const [settleOpen, setSettleOpen] = React.useState(false);
  const [agreementOpen, setAgreementOpen] = React.useState(false);
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
  const canCreateAgreement = can("contracts.create");

  return (
    <div className="space-y-5">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-surface p-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold">{contractor.name}</h1>
            {contractor.status === "INACTIVE" && (
              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-foreground-subtle">Inactive</span>
            )}
          </div>
          <p className="text-sm text-foreground-muted">{contractor.phone || "No mobile"}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-foreground-subtle">Advance balance</p>
          <p
            className={cn(
              "font-mono text-2xl font-semibold",
              contractor.advanceBalancePaise > 0 ? "text-warning-foreground" : "text-foreground",
            )}
          >
            <MoneyText paise={contractor.advanceBalancePaise} />
          </p>
        </div>
      </div>

      {/* Three different instruments, and the difference matters: an advance is
          cash moving early, a settlement is labour being recognised, and an
          agreement is the commercial arrangement itself. Labelling them as one
          undifferentiated row of buttons is how the same money gets recorded
          twice — so each says what it does. */}
      {(isOwner || canCreateAgreement) && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {canCreateAgreement && (
              <Button variant="primary" onClick={() => setAgreementOpen(true)}>
                <FileSignature />
                Create agreement
              </Button>
            )}
            {isOwner && (
              <>
                <Button variant="secondary" onClick={() => setAdvanceOpen(true)}>
                  <Wallet />
                  Record labour advance
                </Button>
                <Button variant="secondary" onClick={() => setSettleOpen(true)}>
                  <Receipt />
                  New settlement
                </Button>
                <Button variant="ghost" onClick={() => setEditOpen(true)}>
                  <Pencil />
                  Edit
                </Button>
              </>
            )}
          </div>
          <p className="text-xs text-foreground-subtle">
            <strong className="font-medium text-foreground-muted">Create agreement</strong> sets up
            the commercial arrangement on a project (value, scope, rates, milestones) —{" "}
            <strong className="font-medium text-foreground-muted">Record labour advance</strong> is
            cash pre-paying future attendance —{" "}
            <strong className="font-medium text-foreground-muted">New settlement</strong> recognises
            attendance already worked. An agreement is optional: attendance-only contractors need
            only the last two.
          </p>
        </div>
      )}

      <CommandCentre
        contractorId={contractor.id}
        ledger={data}
        onCreateAgreement={canCreateAgreement ? () => setAgreementOpen(true) : undefined}
        agreementCreatedAt={createdAt}
      />

      <AddContractorSheet open={editOpen} onOpenChange={setEditOpen} contractor={contractor} />
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
  const [tab, setTab] = React.useState("overview");
  const { data: profile } = useContractorProfile(contractorId);

  const [seenCreatedAt, setSeenCreatedAt] = React.useState(agreementCreatedAt);
  if (seenCreatedAt !== agreementCreatedAt) {
    setSeenCreatedAt(agreementCreatedAt);
    setTab("agreements");
  }
  const { data: settlements = [] } = useSettlements({ contractorId });
  const [reversing, setReversing] = React.useState<ContractorSettlement | null>(null);

  const canSeeAgreements = can("contracts.view");
  const contracts = profile?.projects.flatMap((g) => g.contracts) ?? [];

  // Outstanding labour advances, from the ledger fold — never a stored snapshot.
  const labourAdvanceOutstandingPaise = ledger.entries.reduce(
    (acc, e) => acc + advanceDeltaPaise(e.type, e.amountPaise),
    0,
  );
  const settledAttendancePaise = contracts.reduce(
    (acc, c) => acc + c.reconciliation.attendanceCreditPaise,
    0,
  );

  return (
    <>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full justify-start overflow-x-auto">
          {canSeeAgreements && (
            <>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="agreements">Agreements</TabsTrigger>
              <TabsTrigger value="scope">Scope &amp; Labour</TabsTrigger>
              <TabsTrigger value="rates">Rates</TabsTrigger>
              <TabsTrigger value="milestones">Milestones</TabsTrigger>
              <TabsTrigger value="payments">Payments</TabsTrigger>
              <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </>
          )}
          <TabsTrigger value="ledger">Advance ledger</TabsTrigger>
        </TabsList>

        {canSeeAgreements && profile && (
          <>
            <TabsContent value="overview" className="pt-4">
              <OverviewTab profile={profile} onCreateAgreement={onCreateAgreement} />
            </TabsContent>
            <TabsContent value="agreements" className="pt-4">
              <AgreementsTab
                profile={profile}
                unattributedPaise={0}
                onCreateAgreement={onCreateAgreement}
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
              />
            </TabsContent>
            <TabsContent value="reconciliation" className="pt-4">
              <ReconciliationTab
                profile={profile}
                unattributedPaise={0}
                onCreateAgreement={onCreateAgreement}
              />
            </TabsContent>
            <TabsContent value="history" className="pt-4">
              <HistoryTab contractorId={contractorId} />
            </TabsContent>
          </>
        )}

        <TabsContent value="ledger" className="pt-4">
          <AdvanceLedgerTab ledger={ledger} />
        </TabsContent>
      </Tabs>

      <ReverseSettlementDialog
        settlement={reversing}
        onOpenChange={(o) => !o && setReversing(null)}
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
function AdvanceLedgerTab({ ledger }: { ledger: ContractorLedgerDto }) {
  const { entries } = ledger;
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={Plus}
        title="No ledger entries"
        description="Record a labour advance or a weekly settlement to start the ledger."
      />
    );
  }
  return (
    <div className="space-y-2">
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

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <div className="min-w-[680px]">
          <div className="grid grid-cols-[100px_1fr_140px_120px_130px] items-center border-b border-border bg-surface-muted/50 px-4 py-2.5 text-xs font-medium text-foreground-subtle">
            <span>Date</span>
            <span>Entry</span>
            <span>Scope</span>
            <span className="text-right">Amount</span>
            <span className="text-right">Balance after</span>
          </div>
          {entries.map((e) => (
            <div
              key={e.id}
              className="grid grid-cols-[100px_1fr_140px_120px_130px] items-center border-b border-border px-4 py-2.5 text-sm last:border-0"
            >
              <span className="text-foreground-muted">{formatDate(e.date)}</span>
              <span className="min-w-0">
                <span className={cn("font-medium", TYPE_TONE[e.type])}>{TYPE_LABEL[e.type]}</span>
                {(e.notes || e.projectName) && (
                  <span className="ml-1 truncate text-xs text-foreground-subtle">
                    · {e.notes || e.projectName}
                  </span>
                )}
              </span>
              <span className="truncate text-xs text-foreground-subtle">
                {e.contractTitle ?? (e.projectName ?? "Company-wide")}
              </span>
              <span className={cn("text-right font-mono", TYPE_TONE[e.type])}>
                {TYPE_SIGN[e.type]}
                <MoneyText paise={e.amountPaise} />
              </span>
              <span className="text-right font-mono text-foreground-subtle">
                <MoneyText paise={e.advanceBalanceAfterPaise} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
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
