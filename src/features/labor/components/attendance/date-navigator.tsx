"use client";

/**
 * Move between attendance days.
 *
 * The screen previously offered a bare date field and nothing else, so stepping
 * to yesterday — the single most common move on this page — meant opening a
 * picker and choosing a day. Attendance is entered day after day; the operator
 * walks the calendar far more often than they jump to a date.
 *
 * Future days are refused rather than merely undesirable: labour cannot be
 * recorded before it happens, and the server resolves the rate as at this date.
 */

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Local midnight as YYYY-MM-DD — matches how attendance dates are stamped. */
function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Shifts an ISO date by whole days, in LOCAL time so DST cannot slip a day. */
export function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoOf(new Date(y, m - 1, d + days));
}

export function DateNavigator({
  value,
  onChange,
  /** Today, as the caller computes it — kept injectable so tests can pin it. */
  today,
}: {
  value: string;
  onChange: (iso: string) => void;
  today: string;
}) {
  const isToday = value === today;
  const atMax = value >= today;

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Previous day"
        onClick={() => onChange(shiftIsoDate(value, -1))}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <Input
        type="date"
        aria-label="Attendance date"
        value={value}
        max={today}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="w-[9.5rem]"
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label="Next day"
        // Attendance is never recorded ahead of the work.
        disabled={atMax}
        onClick={() => onChange(shiftIsoDate(value, 1))}
      >
        <ChevronRight className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange(today)}
        disabled={isToday}
        // Disabled ON today is the point: it says where you are, not just what
        // you cannot press.
        aria-label={isToday ? "Showing today" : "Jump to today"}
      >
        Today
      </Button>
    </div>
  );
}
