"use client";

import "../../sync";
import * as React from "react";
import Link from "next/link";
import { CalendarCheck, CheckCheck, CopyPlus, UserPlus, Search, Users } from "lucide-react";
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
import { useProjects } from "@/features/projects/hooks";
import {
  useAttendanceSheet,
  useSetAttendance,
  useSheetActions,
} from "../../hooks";
import { getLastProject, setLastProject, todayISO } from "../../last-project";
import { SyncChip } from "./sync-chip";
import { AttendanceRow } from "./attendance-row";
import { AddWorkersDialog } from "./add-workers-dialog";

export function AttendanceView() {
  const { data: projects = [] } = useProjects({});
  const active = React.useMemo(
    () => projects.filter((p) => !p.archivedAt && p.stage !== "CLOSED"),
    [projects],
  );

  const [selectedId, setSelectedId] = React.useState<string | null>(() => getLastProject());
  const [date, setDate] = React.useState(() => todayISO());
  const [search, setSearch] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);
  const rosterRef = React.useRef<HTMLDivElement>(null);

  // Derive the active project — last-used if still valid, else the first.
  const projectId =
    selectedId && active.some((p) => p.id === selectedId)
      ? selectedId
      : (active[0]?.id ?? null);
  const pid = projectId ?? "";
  const { data: sheet, isLoading } = useAttendanceSheet(projectId, date);
  const setAttendance = useSetAttendance(pid, date);
  const { markAllPresent, copyYesterday, addToCrew } = useSheetActions(pid, date);

  function selectProject(id: string) {
    setSelectedId(id);
    setLastProject(id);
  }

  function moveFocus(dir: 1 | -1) {
    const rows = Array.from(
      rosterRef.current?.querySelectorAll<HTMLElement>("[data-attendance-row]") ?? [],
    );
    const i = rows.indexOf(document.activeElement as HTMLElement);
    rows[i + dir]?.focus();
  }

  const cells = sheet?.cells ?? [];
  const crewIds = new Set(cells.map((c) => c.laborerId));
  const filtered = search
    ? cells.filter(
        (c) =>
          c.fullName.toLowerCase().includes(search.toLowerCase()) ||
          c.trade.toLowerCase().includes(search.toLowerCase()),
      )
    : cells;
  const s = sheet?.summary;

  if (active.length === 0) {
    return (
      <EmptyState
        icon={CalendarCheck}
        title="No active projects"
        description="Create a project first, then record attendance against it."
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
      {/* Controls */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={projectId ?? undefined} onValueChange={selectProject}>
            <SelectTrigger className="min-w-48 flex-1">
              <SelectValue placeholder="Select project" />
            </SelectTrigger>
            <SelectContent>
              {active.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
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
          <Button
            variant="primary"
            className="flex-1 sm:flex-none"
            disabled={cells.length === 0 || markAllPresent.isPending}
            onClick={() => markAllPresent.mutate()}
          >
            <CheckCheck />
            Mark all present
          </Button>
          <Button variant="secondary" onClick={() => copyYesterday.mutate()} disabled={copyYesterday.isPending}>
            <CopyPlus />
            Copy yesterday
          </Button>
          <Button variant="secondary" onClick={() => setAddOpen(true)}>
            <UserPlus />
            Add workers
          </Button>
        </div>

        {cells.length > 6 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a worker…"
              className="pl-9"
            />
          </div>
        )}
      </div>

      {/* Roster */}
      {isLoading ? (
        <RowsSkeleton rows={6} />
      ) : cells.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No crew yet"
          description="Add the workers on this site today. Next time, use “Copy yesterday”."
          action={
            <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
              <UserPlus />
              Add workers
            </Button>
          }
        />
      ) : (
        <div
          ref={rosterRef}
          className="overflow-hidden rounded-xl border border-border bg-surface"
        >
          {filtered.map((cell) => (
            <AttendanceRow
              key={cell.laborerId}
              cell={cell}
              onSet={(status, ot) =>
                setAttendance.mutate({ laborerId: cell.laborerId, status, otHours: ot })
              }
              onMove={moveFocus}
            />
          ))}
        </div>
      )}

      {/* Sticky summary */}
      {cells.length > 0 && s && (
        <div className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-background/90 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
          <div className="mx-auto flex max-w-[1200px] items-center justify-between">
            <div className="flex items-center gap-3 text-sm">
              <span className="font-medium text-success-foreground">{s.present} present</span>
              {s.half > 0 && <span className="text-warning-foreground">{s.half} half</span>}
              {s.absent > 0 && <span className="text-danger-foreground">{s.absent} absent</span>}
              {s.unmarked > 0 && <span className="text-foreground-subtle">{s.unmarked} left</span>}
            </div>
            <div className="text-right">
              <p className="text-[11px] text-foreground-subtle">Wages payable</p>
              <p className="text-lg font-semibold leading-none">
                <MoneyText paise={s.totalWagePaise} whole />
              </p>
            </div>
          </div>
        </div>
      )}

      <AddWorkersDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        crewIds={crewIds}
        isAdding={addToCrew.isPending}
        onAdd={(ids) => {
          addToCrew.mutate(ids, { onSuccess: () => setAddOpen(false) });
        }}
      />
    </div>
  );
}
