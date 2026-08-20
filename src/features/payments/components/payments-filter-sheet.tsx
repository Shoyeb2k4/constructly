"use client";

/**
 * The secondary filters.
 *
 * Search, date, project and type stay on the toolbar because they are what
 * people reach for; party, status and payment mode live here because seven
 * selects in one row is a wall, not a control bar — and on a phone it is three
 * stacked rows of chrome above the first transaction.
 */

import * as React from "react";
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
import { PAYMENT_MODES, PAYMENT_MODE_LABEL } from "@/features/procurement/constants";
import { PARTY_TYPE_LABEL, STATUS_META } from "../constants";
import type { PaymentsFilters } from "../types";

export function PaymentsFilterSheet({
  open,
  onOpenChange,
  filters,
  onChange,
  onClear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: PaymentsFilters;
  onChange: (patch: Partial<PaymentsFilters>) => void;
  onClear: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>More filters</SheetTitle>
          <SheetDescription>Narrow the transaction list further.</SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-6 py-5">
          <div className="space-y-1.5">
            <Label htmlFor="payments-party">Paid to</Label>
            <Select
              value={filters.partyType ?? "ALL"}
              onValueChange={(v) =>
                onChange({ partyType: v as NonNullable<PaymentsFilters["partyType"]> })
              }
            >
              <SelectTrigger id="payments-party">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Anyone</SelectItem>
                {(["CONTRACTOR", "VENDOR"] as const).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PARTY_TYPE_LABEL[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payments-status">Status</Label>
            <Select
              value={filters.status ?? "ALL"}
              onValueChange={(v) =>
                onChange({ status: v as NonNullable<PaymentsFilters["status"]> })
              }
            >
              <SelectTrigger id="payments-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any status</SelectItem>
                {(["ACTIVE", "REVERSED"] as const).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_META[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payments-mode">Payment mode</Label>
            <Select
              value={filters.mode ?? "ALL"}
              onValueChange={(v) => onChange({ mode: v as NonNullable<PaymentsFilters["mode"]> })}
            >
              <SelectTrigger id="payments-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any mode</SelectItem>
                {PAYMENT_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {PAYMENT_MODE_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-foreground-subtle">
              Contractor advances and settlements do not record a payment mode, so
              filtering by mode excludes them.
            </p>
          </div>
        </div>

        <SheetFooter>
          <Button variant="ghost" onClick={onClear}>
            Clear all
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
