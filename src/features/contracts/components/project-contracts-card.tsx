"use client";

import * as React from "react";
import { Plus, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/patterns/empty-state";
import { MoneyText } from "@/components/patterns/money-text";
import { useCan } from "@/features/rbac/permission-context";
import { useProjectContracts } from "../hooks";
import { ContractFormSheet } from "./contract-form-sheet";

/**
 * Project-side commercial view: each contractor's fixed-contract position on
 * this project (value / paid / outstanding). The reverse of the Contractor
 * Detail view. Gated by contracts.view; server re-checks.
 */
export function ProjectContractsCard({ projectId }: { projectId: string }) {
  const can = useCan();
  const { data: rows = [], isLoading } = useProjectContracts(projectId);
  const [createOpen, setCreateOpen] = React.useState(false);

  if (!can("contracts.view")) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground-muted">Fixed contracts</h3>
        {can("contracts.create") && (
          <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New contract
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No agreements"
          description="Add a commercial agreement for a contractor on this project to track earned value, credits and what is payable today."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <div className="min-w-[680px]">
            <div className="grid grid-cols-[1fr_80px_120px_120px_120px_120px] items-center border-b border-border bg-surface-muted/50 px-4 py-2.5 text-xs font-medium text-foreground-subtle">
              <span>Contractor</span>
              <span className="text-right">Agreements</span>
              <span className="text-right">Value</span>
              <span className="text-right">Earned</span>
              <span className="text-right">Credited</span>
              <span className="text-right">Due</span>
            </div>
            {rows.map((r) => (
              <div
                key={r.contractorId}
                className="grid grid-cols-[1fr_80px_120px_120px_120px_120px] items-center border-b border-border px-4 py-2.5 text-sm last:border-0"
              >
                <span className="truncate font-medium">{r.contractorName}</span>
                <span className="text-right text-foreground-muted">{r.agreementCount}</span>
                <span className="text-right font-mono"><MoneyText paise={r.contractValuePaise} /></span>
                <span className="text-right font-mono"><MoneyText paise={r.earnedPaise} /></span>
                <span className="text-right font-mono text-success-foreground"><MoneyText paise={r.creditedPaise} /></span>
                <span className="text-right font-mono text-warning-foreground"><MoneyText paise={r.currentDuePaise} /></span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ContractFormSheet open={createOpen} onOpenChange={setCreateOpen} projectId={projectId} />
    </div>
  );
}
