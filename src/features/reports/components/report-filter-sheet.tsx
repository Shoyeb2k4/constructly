"use client";

/**
 * A report's secondary filters.
 *
 * Period, project, vendor and contractor stay on the toolbar because they say
 * WHAT you are looking at. Transaction type and status REFINE it, and putting
 * six selects in one row is a wall — on a phone it is three stacked rows of
 * chrome above the first figure.
 */

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { REPORT_STATUSES } from "../constants";
import type { ReportFilterKey, ReportFilters } from "../types";

const ALL = "__all__";

export function ReportFilterSheet({
  open,
  onOpenChange,
  keys,
  filters,
  transactionTypes,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keys: ReportFilterKey[];
  filters: ReportFilters;
  transactionTypes: { value: string; label: string }[];
  onChange: (patch: Record<string, string | undefined>) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>More filters</SheetTitle>
          <SheetDescription>Narrow this report further.</SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-6 py-5">
          {keys.includes("transactionType") && (
            <div className="space-y-1.5">
              <Label htmlFor="report-type">Transaction type</Label>
              <Select
                value={filters.transactionType ?? ALL}
                onValueChange={(v) => onChange({ type: v === ALL ? undefined : v })}
              >
                <SelectTrigger id="report-type">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All types</SelectItem>
                  {transactionTypes.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {keys.includes("status") && (
            <div className="space-y-1.5">
              <Label htmlFor="report-status">Status</Label>
              <Select
                value={filters.status ?? "ALL"}
                onValueChange={(v) => onChange({ status: v === "ALL" ? undefined : v })}
              >
                <SelectTrigger id="report-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-foreground-subtle">
                Reversed transactions stay visible as history and are never counted in
                a paid total.
              </p>
            </div>
          )}
        </div>

        <SheetFooter>
          <Button variant="ghost" onClick={() => onChange({ type: undefined, status: undefined })}>
            Clear
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
