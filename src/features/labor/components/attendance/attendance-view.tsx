"use client";

import "../../sync";
import * as React from "react";
import Link from "next/link";
import {
  CalendarCheck,
  ChevronDown,
  CopyPlus,
  Minus,
  Plus,
  StickyNote,
  FileSpreadsheet,
  FileText,
  Tags,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/empty-state";
import { RowsSkeleton } from "@/components/patterns/loading-state";
import { MoneyText } from "@/components/patterns/money-text";
import { cn } from "@/lib/utils";
import { useProjects } from "@/features/projects/hooks";
import { useAttendanceSheet, useSetQuantity, useCopyPreviousDay } from "../../hooks";
import { getLastProject, setLastProject, todayISO } from "../../last-project";
// exports.ts (jsPDF + SheetJS) is lazy-loaded on click to keep it out of the
// route bundle — see the export handlers below.
import { FALLBACK_COLOR } from "../../constants";
import type { SheetGroup, SheetRow } from "../../types";
import { SyncChip } from "./sync-chip";

function SubcategoryRow({
  row,
  onCommit,
}: {
  row: SheetRow;
  onCommit: (quantity: number, notes?: string | null) => void;
}) {
  const [draft, setDraft] = React.useState(String(row.quantity || ""));
  const [showNote, setShowNote] = React.useState(false);
  const [note, setNote] = React.useState(row.notes ?? "");

  // Sync visible inputs when the row changes externally (copy-yesterday, sync)
  // — the React-sanctioned adjust-state-during-render pattern.
  const [prevQty, setPrevQty] = React.useState(row.quantity);
  if (prevQty !== row.quantity) {
    setPrevQty(row.quantity);
    setDraft(String(row.quantity || ""));
  }
  const [prevNotes, setPrevNotes] = React.useState(row.notes);
  if (prevNotes !== row.notes) {
    setPrevNotes(row.notes);
    setNote(row.notes ?? "");
  }

  function commitDraft() {
    const n = Math.max(0, Math.min(5000, parseInt(draft, 10) || 0));
    if (n !== row.quantity) onCommit(n);
    setDraft(String(n || ""));
  }
  function step(delta: number) {
    const next = Math.max(0, Math.min(5000, row.quantity + delta));
    setDraft(String(next || ""));
    onCommit(next);
  }

  return (
    <div className="border-b border-border py-2 pl-8 pr-3 last:border-0">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{row.name}</p>
          {row.dailyRatePaise != null && (
            <p className="text-xs text-foreground-subtle">
              <MoneyText paise={row.dailyRatePaise} whole />/day
            </p>
          )}
        </div>

        <button
          onClick={() => setShowNote((v) => !v)}
          aria-label={`Note for ${row.name}`}
          className={cn(
            "flex size-8 items-center justify-center rounded-md text-foreground-subtle transition-colors hover:bg-surface-muted",
            (showNote || row.notes) && "text-primary",
          )}
        >
          <StickyNote className="size-4" />
        </button>

        <div className="flex items-center overflow-hidden rounded-lg border border-border">
          <button
            onClick={() => step(-1)}
            disabled={row.quantity === 0}
            aria-label={`Fewer ${row.name}`}
            className="flex h-11 w-11 items-center justify-center text-foreground-muted transition-colors hover:bg-surface-muted disabled:opacity-30"
          >
            <Minus className="size-4" />
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
            onBlur={commitDraft}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            inputMode="numeric"
            placeholder="0"
            aria-label={`${row.name} present`}
            className={cn(
              "h-11 w-14 border-x border-border bg-transparent text-center text-base font-semibold tabular-nums outline-none",
              row.quantity > 0 ? "text-foreground" : "text-foreground-subtle",
            )}
          />
          <button
            onClick={() => step(1)}
            aria-label={`More ${row.name}`}
            className="flex h-11 w-11 items-center justify-center text-foreground-muted transition-colors hover:bg-surface-muted"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>

      {showNote && (
        <div className="mt-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => onCommit(row.quantity, note.trim() || null)}
            placeholder="Note for this subcategory…"
            className="h-8 text-sm"
          />
        </div>
      )}
    </div>
  );
}

function CategoryGroup({
  group,
  collapsed,
  onToggle,
  onCommit,
}: {
  group: SheetGroup;
  collapsed: boolean;
  onToggle: () => void;
  onCommit: (subcategoryId: string, quantity: number, notes?: string | null) => void;
}) {
  return (
    <div className="border-b border-border last:border-0">
      <button
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-muted/40"
      >
        <ChevronDown
          className={cn("size-4 shrink-0 text-foreground-subtle transition-transform", collapsed && "-rotate-90")}
        />
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: group.color ?? FALLBACK_COLOR }} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{group.name}</span>
        {group.totalPresent > 0 && (
          <span className="rounded-full bg-surface-muted px-2 py-0.5 font-mono text-xs font-medium tabular-nums">
            {group.totalPresent}
          </span>
        )}
      </button>
      {!collapsed &&
        group.rows.map((row) => (
          <SubcategoryRow
            key={row.subcategoryId}
            row={row}
            onCommit={(qty, notes) => onCommit(row.subcategoryId, qty, notes)}
          />
        ))}
    </div>
  );
}

export function AttendanceView() {
  const { data: projects = [] } = useProjects({});
  const active = React.useMemo(
    () => projects.filter((p) => !p.archivedAt && p.stage !== "CLOSED"),
    [projects],
  );

  const [selectedId, setSelectedId] = React.useState<string | null>(() => getLastProject());
  const [date, setDate] = React.useState(() => todayISO());
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());

  const projectId =
    selectedId && active.some((p) => p.id === selectedId) ? selectedId : (active[0]?.id ?? null);
  const pid = projectId ?? "";
  const projectName = active.find((p) => p.id === projectId)?.name ?? "";

  const { data: sheet, isLoading } = useAttendanceSheet(projectId, date);
  const setQuantity = useSetQuantity(pid, date);
  const copyPrev = useCopyPreviousDay(pid, date);

  function selectProject(id: string) {
    setSelectedId(id);
    setLastProject(id);
  }
  function toggleGroup(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (active.length === 0) {
    return (
      <EmptyState
        icon={CalendarCheck}
        title="No active projects"
        description="Create a project first, then record labour attendance against it."
        action={
          <Button asChild variant="primary" size="sm">
            <Link href="/projects">Go to projects</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 pb-24">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={projectId ?? undefined} onValueChange={selectProject}>
            <SelectTrigger className="min-w-48 flex-1">
              <SelectValue placeholder="Select project" />
            </SelectTrigger>
            <SelectContent>
              {active.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={date}
            max={todayISO()}
            onChange={(e) => setDate(e.target.value)}
            className="w-40"
          />
          <SyncChip />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => copyPrev.mutate()} disabled={copyPrev.isPending || !projectId}>
            <CopyPlus />
            Copy yesterday
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={!sheet || sheet.totalPresent === 0}
              onClick={async () => { if (sheet) (await import("../../exports")).exportSheetPdf(sheet, projectName); }}>
              <FileText />
              PDF
            </Button>
            <Button variant="ghost" size="sm" disabled={!sheet || sheet.totalPresent === 0}
              onClick={async () => { if (sheet) (await import("../../exports")).exportSheetExcel(sheet, projectName); }}>
              <FileSpreadsheet />
              Excel
            </Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <RowsSkeleton rows={6} />
      ) : !sheet || sheet.groups.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="No labour categories"
          description="Set up categories like Carpenter and Mason, each with its subcategories."
          action={
            <Button asChild variant="primary" size="sm">
              <Link href="/labor/categories">Manage categories</Link>
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          {sheet.groups.map((group) => (
            <CategoryGroup
              key={group.categoryId}
              group={group}
              collapsed={collapsed.has(group.categoryId)}
              onToggle={() => toggleGroup(group.categoryId)}
              onCommit={(subcategoryId, quantity, notes) =>
                setQuantity.mutate({ subcategoryId, quantity, notes })
              }
            />
          ))}
        </div>
      )}

      {sheet && (
        <div className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-background/90 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
          <div className="mx-auto flex max-w-[1200px] items-center justify-between">
            <div>
              <p className="text-[11px] text-foreground-subtle">Total present</p>
              <p className="text-lg font-semibold leading-none">{sheet.totalPresent}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-foreground-subtle">Est. labour cost</p>
              <p className="text-lg font-semibold leading-none">
                <MoneyText paise={sheet.estimatedCostPaise} whole />
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
