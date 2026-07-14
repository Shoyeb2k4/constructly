"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, Plus, Check, MoreHorizontal, UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MoneyText } from "@/components/patterns/money-text";
import { EmptyState } from "@/components/patterns/empty-state";
import { RowsSkeleton } from "@/components/patterns/loading-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { LaborerStatus, LaborFilters } from "../types";
import { useLaborers, useTrades, useContractors, useLaborerMutations } from "../hooks";
import { AddLaborerSheet } from "./add-laborer-sheet";

const GRID =
  "grid grid-cols-[32px_1.6fr_90px_40px] md:grid-cols-[32px_1.6fr_110px_1fr_90px_40px] items-center gap-3 px-3";

export function LaborersView() {
  const [search, setSearch] = React.useState("");
  const [trade, setTrade] = React.useState("ALL");
  const [contractorId, setContractorId] = React.useState("ALL");
  const [status, setStatus] = React.useState<LaborerStatus | "ALL">("ALL");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = React.useState(false);
  const parentRef = React.useRef<HTMLDivElement>(null);

  const filters: LaborFilters = { search, trade, contractorId, status };
  const { data: laborers = [], isLoading } = useLaborers(filters);
  const { data: trades = [] } = useTrades();
  const { data: contractors = [] } = useContractors();
  const { setStatus: setStatusM, bulkStatus } = useLaborerMutations();

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: laborers.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 8,
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const allSelected = laborers.length > 0 && selected.size === laborers.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-44 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search workers…" className="pl-9" />
        </div>
        <Select value={trade} onValueChange={setTrade}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All trades</SelectItem>
            {trades.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={contractorId} onValueChange={setContractorId}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All contractors</SelectItem>
            <SelectItem value="NONE">Direct labor</SelectItem>
            {contractors.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as LaborerStatus | "ALL")}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="primary" onClick={() => setAddOpen(true)}>
          <Plus />
          Add worker
        </Button>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-info-subtle/40 px-4 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                bulkStatus.mutate(
                  { ids: [...selected], status: "INACTIVE" },
                  { onSuccess: () => setSelected(new Set()) },
                )
              }
            >
              <UserX />
              Deactivate
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                bulkStatus.mutate(
                  { ids: [...selected], status: "ACTIVE" },
                  { onSuccess: () => setSelected(new Set()) },
                )
              }
            >
              Activate
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <RowsSkeleton rows={6} />
      ) : laborers.length === 0 ? (
        <EmptyState
          icon={UserCheck}
          title="No workers found"
          description="Add workers to your roster, or adjust your filters."
          action={<Button variant="primary" size="sm" onClick={() => setAddOpen(true)}><Plus />Add worker</Button>}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className={cn(GRID, "h-10 border-b border-border bg-surface-muted/40 text-xs font-medium text-foreground-subtle")}>
            <button
              onClick={() => setSelected(allSelected ? new Set() : new Set(laborers.map((l) => l.id)))}
              className={cn(
                "flex size-4 items-center justify-center rounded border",
                allSelected ? "border-primary bg-primary text-white" : "border-border-strong",
              )}
              aria-label="Select all"
            >
              {allSelected && <Check className="size-3" />}
            </button>
            <span>Worker</span>
            <span className="hidden md:block">Daily wage</span>
            <span className="hidden md:block">Contractor</span>
            <span>Status</span>
            <span />
          </div>

          <div ref={parentRef} className="max-h-[calc(100vh-360px)] overflow-y-auto">
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((v) => {
                const l = laborers[v.index];
                const on = selected.has(l.id);
                return (
                  <div
                    key={l.id}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${v.start}px)` }}
                  >
                    <div className={cn(GRID, "h-14 border-b border-border last:border-0 hover:bg-surface-muted/40", l.status === "INACTIVE" && "opacity-60")}>
                      <button
                        onClick={() => toggle(l.id)}
                        className={cn("flex size-4 items-center justify-center rounded border", on ? "border-primary bg-primary text-white" : "border-border-strong")}
                        aria-label="Select"
                      >
                        {on && <Check className="size-3" />}
                      </button>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{l.fullName}</p>
                        <p className="truncate text-xs text-foreground-subtle">{l.trade}</p>
                      </div>
                      <span className="hidden font-mono text-sm md:block"><MoneyText paise={l.dailyWagePaise} whole /></span>
                      <span className="hidden truncate text-sm text-foreground-muted md:block">{l.contractorName ?? "Direct"}</span>
                      <span>
                        <Badge variant={l.status === "ACTIVE" ? "success" : "neutral"}>
                          {l.status === "ACTIVE" ? "Active" : "Inactive"}
                        </Badge>
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8 text-foreground-subtle" aria-label="Actions">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() =>
                              setStatusM.mutate({ id: l.id, status: l.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })
                            }
                          >
                            {l.status === "ACTIVE" ? <UserX /> : <UserCheck />}
                            {l.status === "ACTIVE" ? "Deactivate" : "Activate"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <AddLaborerSheet open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
