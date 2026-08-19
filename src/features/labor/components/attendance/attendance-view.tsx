"use client";

import "../../sync";
import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  CalendarCheck,
  CalendarDays,
  ChevronDown,
  CopyPlus,
  FileSignature,
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
// The React key AND the collapse key. Shared so the two can never drift apart.
import { groupKey } from "../../calc";
// exports.ts (jsPDF + SheetJS) is lazy-loaded on click to keep it out of the
// route bundle — see the export handlers below.
import type { SheetGroup, SheetRow } from "../../types";
import { SyncChip } from "./sync-chip";
import { AttendanceCalendar } from "./attendance-calendar";
import { AddLabourTypeDialog } from "./add-labour-type-dialog";

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

/**
 * One contractor: their agreements, and the labour each covers.
 *
 * The hierarchy the user reads is Contractor → Agreement → Labour Type → Rate →
 * headcount. How the agreement step is presented depends on how many there are,
 * because the cost of an extra tap is real on a site at 7am:
 *
 *  • none  — the attendance-only contractor. No agreement UI at all; this is
 *            exactly the flow that existed before agreements, unchanged.
 *  • one   — auto-selected and named, so nothing is hidden but nothing is asked.
 *  • many  — the user picks. Nothing is pre-selected and no labour type is shown
 *            until they do, because the system must never decide which
 *            agreement a day's work belonged to.
 */
function ContractorGroup({
  group,
  collapsed,
  onToggle,
  onCommit,
  canMark,
  projectId,
  canConfigure,
}: {
  group: SheetGroup;
  collapsed: boolean;
  onToggle: () => void;
  /** The contractor is the group itself; the agreement travels with the row. */
  onCommit: (
    row: { subcategoryId: string; contractId: string | null },
    quantity: number,
    notes?: string | null,
  ) => void;
  canMark: boolean;
  projectId: string;
  /** May add a labour type to this sheet (contracts.edit or projects.edit). */
  canConfigure: boolean;
}) {
  const [addOpen, setAddOpen] = React.useState(false);
  const many = group.requiresAgreementChoice;
  const [chosen, setChosen] = React.useState<string | null>(
    // Exactly one eligible agreement → auto-select it, no extra click.
    many ? null : (group.agreements[0]?.contractId ?? null),
  );

  // The sheet can change under us (project/date switch, sync). Re-derive the
  // selection when the eligible set does — the render-time adjust pattern.
  const agreementKey = group.agreements.map((a) => a.contractId).join(",");
  const [prevKey, setPrevKey] = React.useState(agreementKey);
  if (prevKey !== agreementKey) {
    setPrevKey(agreementKey);
    setChosen(many ? null : (group.agreements[0]?.contractId ?? null));
  }

  const visible = group.agreements.length > 0
    ? group.rows.filter((r) => r.contractId === chosen)
    : group.rows;

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
        {group.archived && (
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground-subtle">
            Archived
          </span>
        )}
        {group.totalPresent > 0 && (
          <span className="rounded-full bg-surface-muted px-2 py-0.5 font-mono text-xs font-medium tabular-nums">
            {group.totalPresent}
          </span>
        )}
      </button>

      {!collapsed && group.agreements.length > 0 && (
        <div className="px-3 pb-2 pl-8">
          {many ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <FileSignature className="size-3.5 shrink-0 text-foreground-subtle" />
              {group.agreements.map((a) => (
                <button
                  key={a.contractId}
                  onClick={() => setChosen(a.contractId)}
                  aria-pressed={chosen === a.contractId}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors",
                    chosen === a.contractId
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "border-border text-foreground-muted hover:bg-surface-muted",
                  )}
                >
                  {a.title}
                </button>
              ))}
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-foreground-subtle">
              <FileSignature className="size-3.5 shrink-0" />
              {group.agreements[0].title}
              {group.agreements[0].reference && ` · ${group.agreements[0].reference}`}
            </p>
          )}
        </div>
      )}

      {!collapsed && many && chosen == null && (
        <p className="px-3 pb-3 pl-8 text-xs text-foreground-subtle">
          This contractor holds {group.agreements.length}{" "}
          agreements here. Choose which one today&rsquo;s labour belongs to — it can&rsquo;t be
          assumed.
        </p>
      )}
      {!collapsed && group.archived && (
        <p className="px-3 pb-2 pl-8 text-xs text-foreground-subtle">
          Archived — no new attendance can be recorded for them. Anything already
          recorded stays here, stays correctable, and can still be settled.
        </p>
      )}
      {!collapsed && visible.length === 0 && !(many && chosen == null) && !group.archived && (
        <p className="px-3 pb-3 pl-8 text-xs text-foreground-subtle">
          No labour types configured for this contractor.
        </p>
      )}
      {!collapsed &&
        visible.map((row) =>
          group.configured ? (
            <SubcategoryRow
              key={`${row.contractId ?? ""}|${row.subcategoryId}`}
              row={row}
              canMark={canMark}
              onCommit={(qty, notes) => onCommit(row, qty, notes)}
            />
          ) : (
            <OrphanRow
              key={`${row.contractId ?? ""}|${row.subcategoryId}`}
              row={row}
              canMark={canMark}
              onClear={() => onCommit(row, 0)}
            />
          ),
        )}

      {/* A missing labour type is fixed here, not on a separate admin screen —
          and never by inventing an agreement just to hold it. */}
      {/* Not offered while archived: a new labour type exists only to record new
          attendance against, which the server refuses. */}
      {!collapsed && group.configured && !group.archived && canConfigure && group.contractorId && !(many && chosen == null) && (
        <div className="px-3 pb-3 pl-8">
          <button
            onClick={() => setAddOpen(true)}
            className="text-xs text-primary transition-colors hover:underline"
          >
            + Add labour type
          </button>
          <AddLabourTypeDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            projectId={projectId}
            contractorId={group.contractorId}
            contractorName={group.contractorName}
            contractId={chosen}
            agreementTitle={group.agreements.find((a) => a.contractId === chosen)?.title ?? null}
          />
        </div>
      )}
    </div>
  );
}

export function AttendanceView() {
  const can = useCan();
  const canMark = can("attendance.mark");
  const canExport = can("attendance.export");
  // Adding a labour type to the sheet edits agreement scope or project config.
  const canConfigure = can("contracts.edit") || can("projects.edit");
  const { data: projects = [] } = useProjects({});
  const active = React.useMemo(
    () => projects.filter((p) => !p.archivedAt && p.stage !== "CLOSED"),
    [projects],
  );

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlProject = searchParams.get("project");

  // The user's in-session / last-remembered choice (used when the URL has no
  // project). Selection is derived below so back/forward and deep links work
  // without a setState-in-effect.
  const [selectedId, setSelectedId] = React.useState<string | null>(() => getLastProject());
  const [date, setDate] = React.useState(() => todayISO());
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [showCalendar, setShowCalendar] = React.useState(false);

  // Selection priority: a valid `?project=` in the URL (deep links, the "Record
  // attendance" link from the project page, back/forward) wins; otherwise the
  // last-remembered project; otherwise the first active project. An unknown or
  // inaccessible id falls through safely to the first active project.
  const preferredId = urlProject ?? selectedId;
  const projectId =
    preferredId && active.some((p) => p.id === preferredId)
      ? preferredId
      : (active[0]?.id ?? null);
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
    // Mirror the selection into the URL so it's shareable and survives refresh /
    // back-forward. `replace` (not push) keeps history clean; scroll:false avoids
    // jumping to the top on every switch.
    const params = new URLSearchParams(searchParams.toString());
    params.set("project", id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }
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
            <Link
              href={`/projects/${pid}?section=contractors&edit=1`}
              className="text-primary hover:underline"
            >
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
              <Link href={`/projects/${pid}?section=contractors&edit=1`}>
                Configure contractors
              </Link>
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
                projectId={pid}
                canConfigure={canConfigure}
                onToggle={() => toggleGroup(key)}
                onCommit={(row, quantity, notes) =>
                  setQuantity.mutate({
                    subcategoryId: row.subcategoryId,
                    quantity,
                    notes,
                    contractorId: group.contractorId,
                    contractId: row.contractId,
                  })
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
