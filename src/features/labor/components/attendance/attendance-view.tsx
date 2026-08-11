"use client";

import "../../sync";
import * as React from "react";
import Link from "next/link";
import {
  CalendarCheck,
  CalendarDays,
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
import { useProjects, useContractorAssignments } from "@/features/projects/hooks";
import { useContractors } from "@/features/contractors/hooks";
import { useAttendanceSheet, useSetQuantity, useCopyPreviousDay } from "../../hooks";
import { useCan } from "@/features/rbac/permission-context";
import { getLastProject, setLastProject, todayISO } from "../../last-project";
// exports.ts (jsPDF + SheetJS) is lazy-loaded on click to keep it out of the
// route bundle — see the export handlers below.
import { FALLBACK_COLOR } from "../../constants";
import type { SheetGroup, SheetRow } from "../../types";
import { SyncChip } from "./sync-chip";
import { AttendanceCalendar } from "./attendance-calendar";

const NONE = "NONE";
type ContractorOption = { id: string; name: string };

function SubcategoryRow({
  row,
  onCommit,
  canMark,
}: {
  row: SheetRow;
  onCommit: (quantity: number, notes?: string | null) => void;
  canMark: boolean;
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

  /** Snap to the nearest half so only 0.5 increments are ever recorded. */
  function snap(n: number) {
    return Math.max(0, Math.min(5000, Math.round(n * 2) / 2));
  }
  function commitDraft() {
    const parsed = Number.parseFloat(draft);
    const n = snap(Number.isFinite(parsed) ? parsed : 0);
    if (n !== row.quantity) onCommit(n);
    setDraft(String(n || ""));
  }
  function step(delta: number) {
    const next = snap(row.quantity + delta);
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
            onClick={() => step(-0.5)}
            disabled={!canMark || row.quantity === 0}
            aria-label={`Half day fewer ${row.name}`}
            className="flex h-11 w-11 items-center justify-center text-foreground-muted transition-colors hover:bg-surface-muted disabled:opacity-30"
          >
            <Minus className="size-4" />
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ""))}
            onBlur={commitDraft}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            inputMode="decimal"
            placeholder="0"
            readOnly={!canMark}
            aria-label={`${row.name} present (0.5 = half day)`}
            className={cn(
              "h-11 w-16 border-x border-border bg-transparent text-center text-base font-semibold tabular-nums outline-none",
              row.quantity > 0 ? "text-foreground" : "text-foreground-subtle",
              !canMark && "cursor-not-allowed",
            )}
          />
          <button
            onClick={() => step(0.5)}
            disabled={!canMark}
            aria-label={`Half day more ${row.name}`}
            className="flex h-11 w-11 items-center justify-center text-foreground-muted transition-colors hover:bg-surface-muted disabled:opacity-30"
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
  canMark,
  contractorOptions,
  selectedContractorId,
  onSelectContractor,
}: {
  group: SheetGroup;
  collapsed: boolean;
  onToggle: () => void;
  onCommit: (subcategoryId: string, quantity: number, notes?: string | null) => void;
  canMark: boolean;
  /** Contractors assigned to THIS category on the selected project. */
  contractorOptions: ContractorOption[];
  selectedContractorId: string | null;
  onSelectContractor: (id: string | null) => void;
}) {
  return (
    <div className="border-b border-border last:border-0">
      <div className="flex w-full items-center gap-3 px-3 py-3">
        <button
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
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
        {/* Per-category contractor: options come from the project's assignments
            for this category, so a contractor can never be recorded against a
            category they aren't assigned to on this project. */}
        {contractorOptions.length > 0 && (
          <Select
            value={selectedContractorId ?? NONE}
            onValueChange={(v) => onSelectContractor(v === NONE ? null : v)}
            disabled={!canMark}
          >
            <SelectTrigger className="h-8 w-40 shrink-0" aria-label={`Contractor for ${group.name}`}>
              <SelectValue placeholder="No contractor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No contractor</SelectItem>
              {contractorOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {!collapsed &&
        group.rows.map((row) => (
          <SubcategoryRow
            key={row.subcategoryId}
            row={row}
            canMark={canMark}
            onCommit={(qty, notes) => onCommit(row.subcategoryId, qty, notes)}
          />
        ))}
    </div>
  );
}

export function AttendanceView() {
  const can = useCan();
  const canMark = can("attendance.mark");
  const canExport = can("attendance.export");
  const { data: projects = [] } = useProjects({});
  const active = React.useMemo(
    () => projects.filter((p) => !p.archivedAt && p.stage !== "CLOSED"),
    [projects],
  );

  const [selectedId, setSelectedId] = React.useState<string | null>(() => getLastProject());
  const [date, setDate] = React.useState(() => todayISO());
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [showCalendar, setShowCalendar] = React.useState(false);

  const projectId =
    selectedId && active.some((p) => p.id === selectedId) ? selectedId : (active[0]?.id ?? null);
  const pid = projectId ?? "";
  const projectName = active.find((p) => p.id === projectId)?.name ?? "";

  const { data: sheet, isLoading } = useAttendanceSheet(projectId, date);
  // Contractors assigned to THIS project (the only ones selectable in Labour).
  const { data: assignments = [] } = useContractorAssignments(projectId);
  // All contractors — used ONLY to resolve the display name of a contractorId
  // already recorded on a row that is no longer in the project's assignments
  // (e.g. an assignment removed after attendance was recorded). Never widens
  // the selectable options.
  const { data: allContractors = [] } = useContractors({});
  const setQuantity = useSetQuantity(pid, date);
  const copyPrev = useCopyPreviousDay(pid, date);

  // categoryId → contractors assigned to it on this project.
  const contractorsByCategory = React.useMemo(() => {
    const m = new Map<string, ContractorOption[]>();
    for (const a of assignments) {
      const list = m.get(a.labourCategoryId) ?? [];
      list.push({ id: a.contractorId, name: a.contractorName });
      m.set(a.labourCategoryId, list);
    }
    return m;
  }, [assignments]);
  const nameById = React.useMemo(
    () => new Map(allContractors.map((c) => [c.id, c.name])),
    [allContractors],
  );

  // Per-category contractor overrides (categoryId → contractorId | null).
  // Reset whenever the project/date changes so a stale selection can never
  // survive a project switch (derive-during-render, no effect).
  const [overrides, setOverrides] = React.useState<Record<string, string | null>>({});
  const scopeKey = `${pid}|${date}`;
  const [syncedScope, setSyncedScope] = React.useState(scopeKey);
  if (syncedScope !== scopeKey) {
    setSyncedScope(scopeKey);
    setOverrides({});
  }

  /** The contractor a category's rows are (or will be) attributed to. */
  function effectiveContractor(group: SheetGroup): string | null {
    if (group.categoryId in overrides) return overrides[group.categoryId];
    const recorded = group.rows.find((r) => r.quantity > 0 && r.contractorId)?.contractorId;
    if (recorded) return recorded;
    const assigned = contractorsByCategory.get(group.categoryId) ?? [];
    return assigned.length === 1 ? assigned[0].id : null;
  }

  /** Selectable + display options for a category's contractor picker. Options
   *  are the project's assignments for that category; a stale recorded value is
   *  appended so it still renders (but re-selecting is limited to assignments). */
  function optionsFor(group: SheetGroup, selected: string | null): ContractorOption[] {
    const assigned = contractorsByCategory.get(group.categoryId) ?? [];
    if (selected && !assigned.some((c) => c.id === selected)) {
      return [...assigned, { id: selected, name: nameById.get(selected) ?? "Unassigned contractor" }];
    }
    return assigned;
  }

  function selectContractorForGroup(group: SheetGroup, next: string | null) {
    setOverrides((prev) => ({ ...prev, [group.categoryId]: next }));
    // Re-attribute every already-recorded row in this category to the new
    // contractor (mirrors the old sheet-level behaviour, now per category).
    for (const r of group.rows) {
      if (r.quantity > 0) {
        setQuantity.mutate({
          subcategoryId: r.subcategoryId,
          quantity: r.quantity,
          notes: r.notes,
          contractorId: next,
        });
      }
    }
  }

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
          <Button
            variant={showCalendar ? "secondary" : "ghost"}
            size="icon"
            onClick={() => setShowCalendar((v) => !v)}
            aria-pressed={showCalendar}
            aria-label="Toggle attendance calendar"
            title="Calendar — days with attendance are highlighted"
          >
            <CalendarDays className="size-4" />
          </Button>
          <SyncChip />
        </div>

        {showCalendar && projectId && (
          <AttendanceCalendar
            projectId={projectId}
            selectedDate={date}
            onSelectDate={setDate}
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          {canMark && (
            <Button variant="secondary" onClick={() => copyPrev.mutate()} disabled={copyPrev.isPending || !projectId}>
              <CopyPlus />
              Copy yesterday
            </Button>
          )}
          {canExport && (
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
          )}
        </div>

        {assignments.length === 0 && (
          <p className="rounded-lg border border-dashed border-border bg-surface-muted/40 px-3 py-2 text-xs text-foreground-muted">
            No contractors are assigned to this project.{" "}
            <Link href={`/projects/${pid}`} className="text-primary hover:underline">
              Assign contractors
            </Link>{" "}
            to attribute this labour for weekly settlement.
          </p>
        )}
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
          {sheet.groups.map((group) => {
            const selected = effectiveContractor(group);
            return (
              <CategoryGroup
                key={group.categoryId}
                group={group}
                collapsed={collapsed.has(group.categoryId)}
                canMark={canMark}
                contractorOptions={optionsFor(group, selected)}
                selectedContractorId={selected}
                onSelectContractor={(id) => selectContractorForGroup(group, id)}
                onToggle={() => toggleGroup(group.categoryId)}
                onCommit={(subcategoryId, quantity, notes) =>
                  setQuantity.mutate({ subcategoryId, quantity, notes, contractorId: selected })
                }
              />
            );
          })}
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
