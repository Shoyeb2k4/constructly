"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAttendanceList } from "../../hooks";
import { todayISO } from "../../last-project";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function iso(year: number, monthIndex: number, day: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Month view for attendance. Dates that already have attendance recorded are
 * highlighted; picking one loads that day's sheet for editing.
 */
export function AttendanceCalendar({
  projectId,
  selectedDate,
  onSelectDate,
}: {
  projectId: string;
  selectedDate: string;
  onSelectDate: (date: string) => void;
}) {
  const [selYear, selMonth] = React.useMemo(() => {
    const [y, m] = selectedDate.split("-").map(Number);
    return [y, m - 1] as const;
  }, [selectedDate]);

  const [cursor, setCursor] = React.useState({ year: selYear, month: selMonth });
  // Follow the selected date when it jumps to a different month.
  const monthKey = `${selYear}-${selMonth}`;
  const [prevKey, setPrevKey] = React.useState(monthKey);
  if (prevKey !== monthKey) {
    setPrevKey(monthKey);
    setCursor({ year: selYear, month: selMonth });
  }

  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const leading = new Date(cursor.year, cursor.month, 1).getDay();
  const from = iso(cursor.year, cursor.month, 1);
  const to = iso(cursor.year, cursor.month, daysInMonth);

  const { data: records = [] } = useAttendanceList({ projectId, from, to });

  /** date → total present that day (drives the highlight + a11y label). */
  const marked = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const r of records) m.set(r.date, (m.get(r.date) ?? 0) + r.quantityPresent);
    return m;
  }, [records]);

  const today = todayISO();
  // Build from a UTC noon anchor and format in IST so the label never drifts a
  // month across a timezone boundary (and stays stable server↔client).
  const monthLabel = new Date(Date.UTC(cursor.year, cursor.month, 1, 12)).toLocaleDateString(
    "en-IN",
    { month: "long", year: "numeric", timeZone: "Asia/Kolkata" },
  );

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={() => shiftMonth(-1)} aria-label="Previous month">
          <ChevronLeft className="size-4" />
        </Button>
        <p className="text-sm font-semibold">{monthLabel}</p>
        <Button variant="ghost" size="icon" onClick={() => shiftMonth(1)} aria-label="Next month">
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="py-1 text-[11px] font-medium text-foreground-subtle">
            {w}
          </span>
        ))}
        {Array.from({ length: leading }).map((_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const date = iso(cursor.year, cursor.month, day);
          const total = marked.get(date);
          const isMarked = total != null && total > 0;
          const isSelected = date === selectedDate;
          const isFuture = date > today;
          return (
            <button
              key={date}
              type="button"
              disabled={isFuture}
              onClick={() => onSelectDate(date)}
              aria-current={isSelected ? "date" : undefined}
              aria-label={isMarked ? `${date} — ${total} present` : date}
              className={cn(
                "flex h-9 items-center justify-center rounded-md text-sm tabular-nums transition-colors",
                isFuture && "cursor-not-allowed opacity-30",
                !isFuture && !isMarked && !isSelected && "text-foreground-muted hover:bg-surface-muted",
                isMarked && !isSelected && "bg-primary/15 font-semibold text-primary hover:bg-primary/25",
                isSelected && "bg-primary font-semibold text-primary-foreground",
              )}
            >
              {day}
            </button>
          );
        })}
      </div>

      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-foreground-subtle">
        <span className="inline-block size-2.5 rounded-sm bg-primary/30" />
        Attendance marked
      </p>
    </div>
  );
}
