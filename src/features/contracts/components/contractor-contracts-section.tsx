"use client";

import * as React from "react";
import { Plus, FileText, MoreVertical, Wallet, Pencil, CheckCircle2, PauseCircle, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";
import { RowsSkeleton } from "@/components/patterns/loading-state";
import { MoneyText } from "@/components/patterns/money-text";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatDate } from "@/features/projects/format";
import { useCan } from "@/features/rbac/permission-context";
import { useContractorProfile, useSetContractStatus, useDeleteContract } from "../hooks";
import {
  CONTRACT_STATUS_LABEL,
  CONTRACT_STATUS_TONE,
  PAYMENT_MODE_LABEL,
  PAYMENT_TYPE_LABEL,
} from "../constants";
import type { Contract } from "../types";
import { ContractFormSheet } from "./contract-form-sheet";
import { RecordContractPaymentSheet } from "./record-contract-payment-sheet";

/**
 * A contractor's commercial position: lifetime header, per-project agreement
 * cards, and payment history. Sits above the advance ledger on the Contractor
 * Detail page. Gated by contracts.* (the server re-checks).
 *
 * Every figure comes from the engine's reconciliation. Note what is deliberately
 * NOT shown as a single "outstanding" number: unearned future work and money
 * payable today are different things, and Due / Ahead are shown side by side
 * because they belong to different agreements and must never cancel out.
 */
export function ContractorContractsSection({ contractorId }: { contractorId: string }) {
  const can = useCan();
  const { data: profile, isLoading } = useContractorProfile(contractorId);
  const setStatus = useSetContractStatus();
  const del = useDeleteContract();

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editContract, setEditContract] = React.useState<Contract | null>(null);
  const [payContract, setPayContract] = React.useState<Contract | null>(null);

  if (!can("contracts.view")) return null;
  if (isLoading) return <RowsSkeleton rows={4} />;

  const lifetime = profile?.lifetime;
  const hasContracts = (profile?.projects.length ?? 0) > 0;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground-muted">Agreements</h2>
        {can("contracts.create") && (
          <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New agreement
          </Button>
        )}
      </div>

      {/* Lifetime position. Due and Ahead are summed per agreement, never netted
          — an advance on one agreement does not settle another's liability. */}
      {hasContracts && lifetime && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Agreement value" money={lifetime.totalContractValuePaise} />
          <Stat label="Earned" money={lifetime.totalEarnedPaise} />
          <Stat label="Credited" money={lifetime.totalCreditedPaise} tone="text-success-foreground" />
          <Stat label="Currently due" money={lifetime.totalCurrentDuePaise} tone="text-warning-foreground" />
          <Stat label="Paid ahead" money={lifetime.totalAdvanceCreditPaise} />
        </div>
      )}

      {!hasContracts ? (
        <EmptyState
          icon={FileText}
          title="No agreements"
          description="Create a commercial agreement (e.g. structural work for ₹60,00,000 over six slabs) to track earned value, credits and what is genuinely payable today."
        />
      ) : (
        <div className="space-y-4">
          {profile!.projects.map((group) => (
            <div key={group.projectId} className="rounded-xl border border-border bg-surface">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <span className="text-sm font-semibold">{group.projectName}</span>
                <span className="text-xs text-foreground-subtle">
                  Credited <MoneyText paise={group.rollup.totalCreditedPaise} /> · Due{" "}
                  <MoneyText paise={group.rollup.totalCurrentDuePaise} />
                  {group.rollup.totalAdvanceCreditPaise > 0 && (
                    <> · Ahead <MoneyText paise={group.rollup.totalAdvanceCreditPaise} /></>
                  )}
                </span>
              </div>
              <div className="divide-y divide-border">
                {group.contracts.map((c) => (
                  <div key={c.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{c.title}</span>
                          <span className={cn("rounded-full px-2 py-0.5 text-[11px]", CONTRACT_STATUS_TONE[c.status])}>
                            {CONTRACT_STATUS_LABEL[c.status]}
                          </span>
                        </div>
                        {c.scope && <p className="mt-0.5 text-xs text-foreground-subtle">{c.scope}</p>}
                        {c.quantity != null && (
                          <p className="text-xs text-foreground-subtle">
                            {c.quantity}
                            {c.unit ? ` ${c.unit}` : ""}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {can("contracts.pay") && c.status !== "CANCELLED" && (
                          <Button variant="secondary" size="sm" onClick={() => setPayContract(c)}>
                            <Wallet className="size-4" />
                            Add payment
                          </Button>
                        )}
                        <ContractMenu
                          contract={c}
                          can={can}
                          onEdit={() => setEditContract(c)}
                          onStatus={(status) => setStatus.mutate({ id: c.id, status })}
                          onDelete={() => {
                            if (confirm(`Delete contract "${c.title}"? Its payments are kept for audit.`)) {
                              del.mutate(c.id);
                            }
                          }}
                        />
                      </div>
                    </div>
                    {/* Earned vs credited, then what is genuinely payable —
                        deliberately not a single "remaining" figure, which would
                        present unearned future work as money owed today. */}
                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                      <Cell label="Agreement value" money={c.currentAmountPaise} />
                      <Cell
                        label={`Earned (${c.reconciliation.milestonesCompleted}/${c.reconciliation.milestonesTotal})`}
                        money={c.reconciliation.earnedValuePaise}
                      />
                      <Cell
                        label="Credited"
                        money={c.reconciliation.totalCreditedPaise}
                        tone="text-success-foreground"
                      />
                      {c.reconciliation.advanceCreditPaise > 0 ? (
                        <Cell label="Paid ahead" money={c.reconciliation.advanceCreditPaise} />
                      ) : (
                        <Cell
                          label="Currently due"
                          money={c.reconciliation.currentDuePaise}
                          tone="text-warning-foreground"
                        />
                      )}
                    </div>
                    <p className="mt-1 text-xs text-foreground-subtle">
                      Remaining unearned work{" "}
                      <MoneyText paise={c.reconciliation.remainingUnearnedPaise} /> · Overall balance{" "}
                      <MoneyText paise={c.reconciliation.overallBalancePaise} />
                      {c.reconciliation.unsettledAttendancePaise > 0 && (
                        <>
                          {" "}
                          · <MoneyText paise={c.reconciliation.unsettledAttendancePaise} /> labour
                          recorded but not yet settled
                        </>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Payment history */}
      {profile && profile.payments.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-foreground-muted">Payment history</h3>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-[90px_1fr_1fr_90px_120px_110px] items-center border-b border-border bg-surface-muted/50 px-4 py-2.5 text-xs font-medium text-foreground-subtle">
                <span>Date</span>
                <span>Project</span>
                <span>Work</span>
                <span>Type</span>
                <span className="text-right">Amount</span>
                <span className="text-right">Mode</span>
              </div>
              {profile.payments.map((p) => (
                <div
                  key={p.id}
                  className="grid grid-cols-[90px_1fr_1fr_90px_120px_110px] items-center border-b border-border px-4 py-2.5 text-sm last:border-0"
                >
                  <span className="text-foreground-muted">{formatDate(p.date)}</span>
                  <span className="truncate">{p.projectName}</span>
                  <span className="truncate text-foreground-muted">{p.contractTitle}</span>
                  <span className="text-xs text-foreground-subtle">{PAYMENT_TYPE_LABEL[p.type]}</span>
                  <span className="text-right font-mono text-success-foreground">
                    <MoneyText paise={p.amountPaise} />
                  </span>
                  <span className="text-right text-xs text-foreground-subtle">{PAYMENT_MODE_LABEL[p.paymentMode]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <ContractFormSheet open={createOpen} onOpenChange={setCreateOpen} contractorId={contractorId} />
      {editContract && (
        <ContractFormSheet
          open={!!editContract}
          onOpenChange={(o) => !o && setEditContract(null)}
          contract={editContract}
        />
      )}
      {payContract && (
        <RecordContractPaymentSheet
          open={!!payContract}
          onOpenChange={(o) => !o && setPayContract(null)}
          contract={payContract}
        />
      )}
    </section>
  );
}

function Stat({ label, value, money, tone }: { label: string; value?: string; money?: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="text-xs text-foreground-subtle">{label}</p>
      <p className={cn("mt-0.5 font-mono text-lg font-semibold", tone)}>
        {money != null ? <MoneyText paise={money} /> : value}
      </p>
    </div>
  );
}

function Cell({ label, money, tone }: { label: string; money: number; tone?: string }) {
  return (
    <div>
      <p className="text-xs text-foreground-subtle">{label}</p>
      <p className={cn("font-mono", tone)}>
        <MoneyText paise={money} />
      </p>
    </div>
  );
}

function ContractMenu({
  contract,
  can,
  onEdit,
  onStatus,
  onDelete,
}: {
  contract: Contract;
  can: (p: import("@/features/rbac/permissions").Permission) => boolean;
  onEdit: () => void;
  onStatus: (status: Contract["status"]) => void;
  onDelete: () => void;
}) {
  const canEdit = can("contracts.edit");
  const canComplete = can("contracts.complete");
  const canDelete = can("contracts.delete");
  if (!canEdit && !canComplete && !canDelete) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Contract actions">
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canEdit && (
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil className="size-4" />
            Edit agreement
          </DropdownMenuItem>
        )}
        {canComplete && contract.status !== "COMPLETED" && contract.status !== "SETTLED" && (
          <DropdownMenuItem onSelect={() => onStatus("COMPLETED")}>
            <CheckCircle2 className="size-4" />
            Mark completed
          </DropdownMenuItem>
        )}
        {canComplete && contract.status !== "ON_HOLD" && contract.status !== "COMPLETED" && (
          <DropdownMenuItem onSelect={() => onStatus("ON_HOLD")}>
            <PauseCircle className="size-4" />
            Put on hold
          </DropdownMenuItem>
        )}
        {canComplete && contract.status !== "IN_PROGRESS" && (
          <DropdownMenuItem onSelect={() => onStatus("IN_PROGRESS")}>
            <CheckCircle2 className="size-4" />
            Resume
          </DropdownMenuItem>
        )}
        {/* Delete is only ever available for an agreement with NO financial
            history; the server refuses otherwise and the caller cancels instead. */}
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete} className="text-danger-foreground">
              <Trash2 className="size-4" />
              Delete agreement
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
