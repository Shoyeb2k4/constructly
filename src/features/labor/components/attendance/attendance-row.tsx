"use client";

import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { MoneyText } from "@/components/patterns/money-text";
import { cn } from "@/lib/utils";
import type { AttendanceCell, AttendanceStatus } from "../../types";
import { computeWage } from "../../wage";

const SEGMENTS: { value: AttendanceStatus; label: string; on: string }[] = [
  { value: "PRESENT", label: "P", on: "bg-success text-white" },
  { value: "HALF_DAY", label: "½", on: "bg-warning text-white" },
  { value: "ABSENT", label: "A", on: "bg-danger text-white" },
];

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

export function AttendanceRow({
  cell,
  onSet,
  onMove,
}: {
  cell: AttendanceCell;
  onSet: (status: AttendanceStatus | null, otHours: number) => void;
  onMove: (dir: 1 | -1) => void;
}) {
  const canOt = cell.status === "PRESENT" || cell.status === "HALF_DAY";
  const preview =
    cell.status != null
      ? cell.wagePayablePaise
      : computeWage(cell.dailyWagePaise, null).wagePayablePaise;

  function onKeyDown(e: React.KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (k === "p") onSet("PRESENT", cell.otHours);
    else if (k === "h") onSet("HALF_DAY", cell.otHours);
    else if (k === "a") onSet("ABSENT", 0);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      onMove(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      onMove(-1);
    } else return;
    e.preventDefault();
  }

  return (
    <div
      data-attendance-row
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex items-center gap-3 border-b border-border px-3 py-2.5 outline-none last:border-0 focus-visible:bg-surface-muted/50"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-medium text-foreground-muted">
        {initials(cell.fullName)}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{cell.fullName}</p>
        <p className="truncate text-xs text-foreground-subtle">
          {cell.trade} · <MoneyText paise={cell.dailyWagePaise} whole />
          {cell.contractorName ? ` · ${cell.contractorName}` : ""}
        </p>
      </div>

      {canOt && (
        <div className="hidden items-center gap-1 sm:flex" aria-label="Overtime hours">
          <button
            onClick={() => onSet(cell.status, Math.max(0, cell.otHours - 1))}
            className="flex size-7 items-center justify-center rounded-md border border-border text-foreground-muted hover:bg-surface-muted"
            aria-label="Less overtime"
          >
            <Minus className="size-3.5" />
          </button>
          <span className="w-12 text-center text-xs tabular-nums text-foreground-muted">
            OT {cell.otHours}h
          </span>
          <button
            onClick={() => onSet(cell.status, Math.min(12, cell.otHours + 1))}
            className="flex size-7 items-center justify-center rounded-md border border-border text-foreground-muted hover:bg-surface-muted"
            aria-label="More overtime"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      )}

      <div className="w-16 shrink-0 text-right">
        {cell.status != null && cell.status !== "ABSENT" ? (
          <span className="font-mono text-xs tabular-nums text-foreground-muted">
            <MoneyText paise={preview} whole />
          </span>
        ) : null}
      </div>

      <div className="flex shrink-0 overflow-hidden rounded-lg border border-border">
        {SEGMENTS.map((s) => {
          const active = cell.status === s.value;
          return (
            <button
              key={s.value}
              onClick={() => onSet(s.value, s.value === "ABSENT" ? 0 : cell.otHours)}
              aria-pressed={active}
              className={cn(
                "flex h-11 w-11 items-center justify-center text-sm font-semibold transition-colors",
                active ? s.on : "bg-surface text-foreground-subtle hover:bg-surface-muted",
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
