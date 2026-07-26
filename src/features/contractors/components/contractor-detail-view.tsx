"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Pencil, Wallet, Receipt, Download } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";
import { RowsSkeleton } from "@/components/patterns/loading-state";
import { MoneyText } from "@/components/patterns/money-text";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatDate } from "@/features/projects/format";
import { useContractorLedger } from "../hooks";
import type { ContractorLedgerType } from "../types";
import { AddContractorSheet } from "./add-contractor-sheet";
import { RecordAdvanceSheet } from "./record-advance-sheet";
import { SettlementSheet } from "./settlement-sheet";

const TYPE_LABEL: Record<ContractorLedgerType, string> = {
  OPENING_ADVANCE: "Opening advance",
  ADVANCE: "Advance paid",
  LABOUR_BILL: "Labour bill",
  ADJUSTMENT: "Advance adjusted",
  PAYMENT: "Payment made",
};
const TYPE_SIGN: Record<ContractorLedgerType, string> = {
  OPENING_ADVANCE: "+",
  ADVANCE: "+",
  ADJUSTMENT: "−",
  LABOUR_BILL: "",
  PAYMENT: "",
};
const TYPE_TONE: Record<ContractorLedgerType, string> = {
  OPENING_ADVANCE: "text-foreground",
  ADVANCE: "text-foreground",
  ADJUSTMENT: "text-warning-foreground",
  LABOUR_BILL: "text-foreground-muted",
  PAYMENT: "text-success-foreground",
};

export function ContractorDetailView({
  contractorId,
  isOwner,
}: {
  contractorId: string;
  isOwner: boolean;
}) {
  const { data, isLoading } = useContractorLedger(contractorId);
  const [editOpen, setEditOpen] = React.useState(false);
  const [advanceOpen, setAdvanceOpen] = React.useState(false);
  const [settleOpen, setSettleOpen] = React.useState(false);

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

  const { contractor, entries } = data;

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

      {isOwner && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setAdvanceOpen(true)}>
            <Wallet />
            Record advance
          </Button>
          <Button variant="secondary" onClick={() => setSettleOpen(true)}>
            <Receipt />
            New settlement
          </Button>
          <Button variant="ghost" onClick={() => setEditOpen(true)}>
            <Pencil />
            Edit
          </Button>
        </div>
      )}

      {/* Ledger */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground-muted">Ledger</h2>
          {entries.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm">
                  <Download className="size-4" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={async () => (await import("../exports")).exportLedgerExcel(data)}
                >
                  Excel
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={async () => (await import("../exports")).exportLedgerPdf(data)}
                >
                  PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {entries.length === 0 ? (
          <EmptyState
            icon={Plus}
            title="No ledger entries"
            description="Record an advance or a weekly settlement to start the ledger."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <div className="min-w-[560px]">
              <div className="grid grid-cols-[100px_1fr_120px_130px] items-center border-b border-border bg-surface-muted/50 px-4 py-2.5 text-xs font-medium text-foreground-subtle">
                <span>Date</span>
                <span>Entry</span>
                <span className="text-right">Amount</span>
                <span className="text-right">Advance bal.</span>
              </div>
              {entries.map((e) => (
                <div
                  key={e.id}
                  className="grid grid-cols-[100px_1fr_120px_130px] items-center border-b border-border px-4 py-2.5 text-sm last:border-0"
                >
                  <span className="text-foreground-muted">{formatDate(e.date)}</span>
                  <span className="min-w-0">
                    <span className={cn("font-medium", TYPE_TONE[e.type])}>{TYPE_LABEL[e.type]}</span>
                    {(e.projectName || e.notes) && (
                      <span className="ml-1 truncate text-xs text-foreground-subtle">
                        · {e.projectName || e.notes}
                      </span>
                    )}
                  </span>
                  <span className={cn("text-right font-mono", TYPE_TONE[e.type])}>
                    {TYPE_SIGN[e.type]}
                    <MoneyText paise={e.amountPaise} />
                  </span>
                  <span className="text-right font-mono text-foreground-muted">
                    <MoneyText paise={e.advanceBalanceAfterPaise} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

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
