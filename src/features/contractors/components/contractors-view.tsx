"use client";

import * as React from "react";
import Link from "next/link";
import { HardHat, Plus, Search, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { RowsSkeleton } from "@/components/patterns/loading-state";
import { MoneyText } from "@/components/patterns/money-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useContractors } from "../hooks";
import type { ContractorStatus } from "../types";
import { AddContractorSheet } from "./add-contractor-sheet";

export function ContractorsView({ isOwner }: { isOwner: boolean }) {
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<ContractorStatus | "ALL">("ALL");
  const [addOpen, setAddOpen] = React.useState(false);

  const { data: contractors = [], isLoading } = useContractors({ search, status });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Contractors"
        description="Labour contractors, their advances, and weekly settlements."
        actions={
          isOwner ? (
            <Button variant="primary" onClick={() => setAddOpen(true)}>
              <Plus />
              Add contractor
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-44 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or mobile…"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as ContractorStatus | "ALL")}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <RowsSkeleton rows={6} />
      ) : contractors.length === 0 ? (
        <EmptyState
          icon={HardHat}
          title={search || status !== "ALL" ? "No contractors match" : "No contractors yet"}
          description={
            search || status !== "ALL"
              ? "Try a different search or status."
              : "Add a labour contractor to record advances and weekly settlements."
          }
          action={
            isOwner && !(search || status !== "ALL") ? (
              <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
                <Plus />
                Add contractor
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="grid grid-cols-[1fr_auto] items-center border-b border-border bg-surface-muted/50 px-4 py-2.5 text-xs font-medium text-foreground-subtle">
            <span>Contractor</span>
            <span className="text-right">Advance balance</span>
          </div>
          {contractors.map((c) => (
            <Link
              key={c.id}
              href={`/labor/contractors/${c.id}`}
              className="grid grid-cols-[1fr_auto] items-center border-b border-border px-4 py-3 transition-colors last:border-0 hover:bg-surface-muted/50"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  {c.status === "INACTIVE" && (
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-foreground-subtle">
                      Inactive
                    </span>
                  )}
                </div>
                <span className="text-xs text-foreground-subtle">{c.phone || "—"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "font-mono text-sm",
                    c.advanceBalancePaise > 0 ? "text-warning-foreground" : "text-foreground-muted",
                  )}
                >
                  <MoneyText paise={c.advanceBalancePaise} />
                </span>
                <ChevronRight className="size-4 text-foreground-subtle" />
              </div>
            </Link>
          ))}
        </div>
      )}

      <AddContractorSheet open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
