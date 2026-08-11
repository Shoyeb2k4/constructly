"use client";

import "../../sync";
import * as React from "react";
import Link from "next/link";
import {
  CalendarCheck,
  CalendarDays,
  ChevronDown,
  CopyPlus,
  HardHat,
  Minus,
  Plus,
  StickyNote,
  FileSpreadsheet,
  FileText,
  Tags,
  X,
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
import { useCan } from "@/features/rbac/permission-context";
import { getLastProject, setLastProject, todayISO } from "../../last-project";
// exports.ts (jsPDF + SheetJS) is lazy-loaded on click to keep it out of the
// route bundle — see the export handlers below.
import type { SheetGroup, SheetRow } from "../../types";
import { SyncChip } from "./sync-chip";
import { AttendanceCalendar } from "./attendance-calendar";

/** One labour-type row: name, read-only rate, and the headcount stepper. */
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
            placeholder="Note for this labour type…"
            className="h-8 text-sm"
          />
        </div>
      )}
    </div>
  );
}

/** A read-only row for labour recorded against a contractor/type no longer
 *  configured on the project (or legacy unattributed rows). Shows the recorded
 *  count with a Clear affordance so history can be zeroed but not grown. */
function OrphanRow({
  row,
  onClear,
  canMark,
}: {
  row: SheetRow;
  onClear: () => void;
  canMark: boolean;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border py-2 pl-8 pr-3 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{row.name}</p>
        {row.dailyRatePaise != null && (
          <p className="text-xs text-foreground-subtle">
            <MoneyText paise={row.dailyRatePaise} whole />/day
          </p>
        )}
      </div>
      <span className="font-mono text-sm font-semibold tabular-nums text-foreground-muted">
        {row.quantity}
      </span>
      {canMark && (
        <button
          onClick={onClear}
          aria-label={`Clear ${row.name}`}
          className="flex size-8 items-center justify-center rounded-md text-foreground-subtle transition-colors hover:bg-surface-muted hover:text-danger-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

function ContractorGroup({
  group,
  collapsed,
  onToggle,
  onCommit,
  canMark,
}: {
  group: SheetGroup;
  collapsed: boolean;
  onToggle: () => void;
  /** (subcategoryId, quantity, notes) — the contractor is the group itself. */
  onCommit: (subcategoryId: string, quantity: number, notes?: string | null) => void;
  canMark: boolean;
}) {
  return (
    <div className="border-b border-border last:border-0">
      <button
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-3 px-3 py-3 text-left"
      >
        <ChevronDown
          className={cn("size-4 shrink-0 text-foreground-subtle transition-transform", collapsed && "-rotate-90")}
        />
        <HardHat className="size-4 shrink-0 text-foreground-subtle" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{group.contractorName}</span>
        {!group.configured && (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning-foreground">
            Not configured
          </span>
        )}
        {group.totalPresent > 0 && (
          <span className="rounded-full bg-surface-muted px-2 py-0.5 font-mono text-xs font-medium tabular-nums">
            {group.totalPresent}
          </span>
        )}
      </button>
      {!collapsed && group.rows.length === 0 && (
        <p className="px-3 pb-3 pl-8 text-xs text-foreground-subtle">
          No labour types configured for this contractor.
        </p>
      )}
      {!collapsed &&
        group.rows.map((row) =>
          group.configured ? (
            <SubcategoryRow
              key={row.subcategoryId}
              row={row}
              canMark={canMark}
              onCommit={(qty, notes) => onCommit(row.subcategoryId, qty, notes)}
            />
          ) : (
            <OrphanRow
              key={row.subcategoryId}
              row={row}
              canMark={canMark}
              onClear={() => onCommit(row.subcategoryId, 0)}
            />
          ),
        )}
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
  const setQuantity = useSetQuantity(pid, date);
  const copyPrev = useCopyPreviousDay(pid, date);

  const hasConfigured = React.useMemo(
    () => (sheet?.groups ?? []).some((g) => g.configured),
    [sheet],
  );

  function selectProject(id: string) {
    setSelectedId(id);
    setLastProject(id);
  }
  /** Group collapse key (contractorId, or a stable token for unattributed). */
  const groupKey = (g: SheetGroup) => g.contractorId ?? "__unattributed__";
  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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

        {sheet && !hasConfigured && (
          <p className="rounded-lg border border-dashed border-border bg-surface-muted/40 px-3 py-2 text-xs text-foreground-muted">
            No contractors are configured for this project.{" "}
            <Link href={`/projects/${pid}`} className="text-primary hover:underline">
              Add contractors
            </Link>{" "}
            and the labour types they supply to record attendance.
          </p>
        )}
      </div>

      {isLoading ? (
        <RowsSkeleton rows={6} />
      ) : !sheet || sheet.groups.length === 0 ? (
        <EmptyState
          icon={hasConfigured ? Tags : HardHat}
          title="Nothing to record yet"
          description="Add contractors and their labour types to this project, then record attendance here."
          action={
            <Button asChild variant="primary" size="sm">
              <Link href={`/projects/${pid}`}>Configure contractors</Link>
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          {sheet.groups.map((group) => {
            const key = groupKey(group);
            return (
              <ContractorGroup
                key={key}
                group={group}
                collapsed={collapsed.has(key)}
                canMark={canMark}
                onToggle={() => toggleGroup(key)}
                onCommit={(subcategoryId, quantity, notes) =>
                  setQuantity.mutate({ subcategoryId, quantity, notes, contractorId: group.contractorId })
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
