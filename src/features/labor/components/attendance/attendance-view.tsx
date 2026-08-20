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
  MoreHorizontal,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/empty-state";
import { RowsSkeleton } from "@/components/patterns/loading-state";
import { MoneyText } from "@/components/patterns/money-text";
import { Toolbar, ToolbarGroup, ToolbarSpacer } from "@/components/patterns/toolbar";
import { Callout } from "@/components/patterns/callout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DateNavigator } from "./date-navigator";
import { CopyPreviousDayDialog } from "./copy-previous-day-dialog";
import { cn } from "@/lib/utils";
import { useProjects } from "@/features/projects/hooks";
import { useIsHydrated } from "@/lib/use-is-hydrated";
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

/**
 * Loading geometry that matches the loaded screen: a control bar, then grouped
 * rows. A skeleton shaped differently from its result is a layout shift with
 * extra steps.
 */
function AttendanceSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 min-w-48 flex-1" />
        <Skeleton className="h-9 w-56" />
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {[0, 1].map((g) => (
          <div key={g} className="border-b border-border last:border-0">
            <div className="flex items-center gap-3 px-3 py-3">
              <Skeleton className="size-4 rounded" />
              <Skeleton className="h-4 w-44" />
            </div>
            {[0, 1].map((r) => (
              <div
                key={r}
                className="flex items-center justify-between gap-3 border-t border-border py-2 pl-3 pr-3 sm:pl-8"
              >
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-11 w-[9.5rem] rounded-lg" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

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
    <div className="border-b border-border py-2 pl-3 pr-3 last:border-0 sm:pl-8">
      {/* The stepper is a fixed 152px and the name is the thing being counted,
          so on a phone they get their OWN rows rather than competing: the name
          was truncating to 78px against a 104-116px need, which left the
          operator stepping a quantity they could not identify. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium sm:truncate">{row.name}</p>
          <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-foreground-muted">
            {row.dailyRatePaise != null ? (
              <span>
                <MoneyText paise={row.dailyRatePaise} whole />/day
              </span>
            ) : (
              <span className="text-foreground-subtle">No rate set</span>
            )}
            {/* Attendance VALUE — this quantity at the rate snapshotted for this
                date. Not "due" and not "payable": it becomes agreement credit
                only when a settlement recognises it. */}
            {row.dailyRatePaise != null && row.quantity > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-foreground">
                  <MoneyText paise={Math.round(row.dailyRatePaise * row.quantity)} whole />
                </span>
              </>
            )}
            {row.agreementTitle && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{row.agreementTitle}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 self-end sm:self-auto">
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
            // Recessed rather than faded: `opacity` composites text toward the
            // background and was measured breaking contrast elsewhere.
            className="flex h-11 w-11 items-center justify-center text-foreground-muted transition-colors hover:bg-surface-muted disabled:text-foreground-subtle"
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
            className="flex h-11 w-11 items-center justify-center text-foreground-muted transition-colors hover:bg-surface-muted disabled:text-foreground-subtle"
          >
            <Plus className="size-4" />
          </button>
        </div>
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
        {/* A historical group is not invalid — it is labour recorded against a
            contractor/type this project no longer lists. "Not configured" says
            that; a red or faded treatment would say "broken". */}
        {!group.configured && (
          <Badge variant="neutral" className="shrink-0">
            Not configured
          </Badge>
        )}
        {group.archived && (
          <Badge variant="neutral" className="shrink-0">
            Archived
          </Badge>
        )}
        {group.totalPresent > 0 && (
          <span className="flex shrink-0 items-baseline gap-2">
            <span className="font-mono text-xs font-medium tabular-nums text-foreground-muted">
              {group.totalPresent} present
            </span>
            <span className="hidden font-mono text-sm font-semibold tabular-nums sm:inline">
              <MoneyText paise={group.estimatedCostPaise} whole />
            </span>
          </span>
        )}
      </button>

      {/* Why new entry is refused, said once at the group — not inferred from a
          missing stepper. Existing rows stay fully readable and correctable. */}
      {!collapsed && group.archived && (
        <div className="px-3 pb-2 pl-8">
          <Callout tone="neutral" title="This contractor is archived">
            No new attendance can be recorded for them. What is already here stays, remains
            correctable, and can still be settled.
          </Callout>
        </div>
      )}

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
                      ? "border-primary bg-primary-subtle font-medium text-primary-emphasis"
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
  const hydrated = useIsHydrated();
  const { data: projects = [], isPending: projectsPending } = useProjects({});
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
  const [copyOpen, setCopyOpen] = React.useState(false);

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

  // DEFECT FIX (pre-existing). Two separate bugs met here.
  //
  // 1. The empty state was reached whenever `projects` was empty — which is
  //    ALWAYS true on the server, because React Query has no data there. "We
  //    have not asked yet" and "there are none" are different states.
  // 2. Everything this screen shows comes from the browser, so even a correct
  //    pending check disagrees across the hydration boundary once the query
  //    resolves mid-flight. React then discards the server tree and re-renders
  //    the branch, logging a hydration mismatch on every single load.
  //
  // Gating on hydration makes the server render and the hydration render agree
  // by construction; the pending check then does its ordinary job.
  if (!hydrated || projectsPending) return <AttendanceSkeleton />;

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
        {/* WHAT you are looking at, first and always visible: project, then
            date. Acting on it — calendar, copy, exports — collapses into the
            menu, because a reporting export is not an operator's first concern
            and must never outrank the entry field on a phone. */}
        <Toolbar aria-label="Attendance controls">
          <ToolbarGroup grow>
            <Select value={projectId ?? undefined} onValueChange={selectProject}>
              <SelectTrigger className="w-full" aria-label="Project">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {active.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ToolbarGroup>

          <ToolbarGroup>
            <DateNavigator value={date} onChange={setDate} today={todayISO()} />
          </ToolbarGroup>

          <ToolbarSpacer />

          <ToolbarGroup>
            <SyncChip />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More attendance actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setShowCalendar((v) => !v);
                  }}
                >
                  <CalendarDays />
                  {showCalendar ? "Hide calendar" : "Show calendar"}
                </DropdownMenuItem>
                {canMark && (
                  <DropdownMenuItem
                    disabled={copyPrev.isPending || !projectId}
                    onSelect={() => setCopyOpen(true)}
                  >
                    <CopyPlus />
                    Copy yesterday…
                  </DropdownMenuItem>
                )}
                {canExport && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={!sheet || sheet.totalPresent === 0}
                      onSelect={async () => {
                        if (sheet) (await import("../../exports")).exportSheetPdf(sheet, projectName);
                      }}
                    >
                      <FileText />
                      Export PDF
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!sheet || sheet.totalPresent === 0}
                      onSelect={async () => {
                        if (sheet) (await import("../../exports")).exportSheetExcel(sheet, projectName);
                      }}
                    >
                      <FileSpreadsheet />
                      Export Excel
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </ToolbarGroup>
        </Toolbar>

        {showCalendar && projectId && (
          <AttendanceCalendar
            projectId={projectId}
            selectedDate={date}
            onSelectDate={setDate}
          />
        )}

        {sheet && !hasConfigured && (
          <Callout tone="info" title="No contractors are configured for this project">
            <Link
              href={`/projects/${pid}?section=contractors&edit=1`}
              className="rounded-sm font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Add contractors
            </Link>{" "}
            and the labour types they supply, and attendance can be recorded here.
          </Callout>
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

      <CopyPreviousDayDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        sheet={sheet}
        isPending={copyPrev.isPending}
        onConfirm={() => copyPrev.mutate(undefined, { onSuccess: () => setCopyOpen(false) })}
      />

      {sheet && (
        <div className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-background/90 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
          {/* "Attendance value", never "Due" or "Payable". This is what today's
              quantity is worth at the rate snapshotted for this date; it becomes
              agreement credit only once a settlement recognises it, and the
              contractor's Due is a different figure computed from agreements. */}
          <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] text-foreground-muted">Total present</p>
              <p className="text-lg font-semibold leading-none tabular-nums">
                {sheet.totalPresent}
              </p>
            </div>
            <div className="min-w-0 text-right">
              <p className="text-[11px] text-foreground-muted">Attendance value</p>
              <p className="text-lg font-semibold leading-none">
                <MoneyText paise={sheet.estimatedCostPaise} whole />
              </p>
              <p className="text-[11px] text-foreground-subtle">
                Unsettled until a settlement runs
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
