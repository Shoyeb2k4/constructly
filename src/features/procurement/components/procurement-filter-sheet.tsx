"use client";

import { MoneyInput } from "@/components/patterns/money-input";
import * as React from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PO_STATUSES, PO_STATUS_LABEL, PO_PAYMENT_STATUSES, PO_PAYMENT_STATUS_LABEL } from "../constants";
import type { POFilters, POGstFilter } from "../types";

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/** A Select whose "ALL" sentinel means "no filter". */
function AllSelect({
  value,
  onValueChange,
  allLabel,
  options,
}: {
  value: string;
  onValueChange: (v: string) => void;
  allLabel: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="ALL">{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ProcurementFilterSheet({
  open,
  onOpenChange,
  filters,
  onChange,
  onClearAll,
  projects,
  vendors,
  materials,
  categories,
  members,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  filters: POFilters;
  onChange: (patch: Partial<POFilters>) => void;
  onClearAll: () => void;
  projects: { id: string; name: string }[];
  vendors: { id: string; businessName: string }[];
  materials: string[];
  categories: string[];
  members: { id: string; fullName: string }[];
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Filter purchase orders</SheetTitle>
          <SheetDescription>Combine any of these. They apply alongside search and sort.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <FilterRow label="Project">
            <AllSelect
              value={filters.projectId ?? "ALL"}
              onValueChange={(v) => onChange({ projectId: v })}
              allLabel="All projects"
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
            />
          </FilterRow>

          <FilterRow label="Vendor">
            <AllSelect
              value={filters.vendorId ?? "ALL"}
              onValueChange={(v) => onChange({ vendorId: v })}
              allLabel="All vendors"
              options={vendors.map((x) => ({ value: x.id, label: x.businessName }))}
            />
          </FilterRow>

          <div className="grid grid-cols-2 gap-3">
            <FilterRow label="Status">
              <AllSelect
                value={filters.status ?? "ALL"}
                onValueChange={(v) => onChange({ status: v as POFilters["status"] })}
                allLabel="Any status"
                options={PO_STATUSES.map((s) => ({ value: s, label: PO_STATUS_LABEL[s] }))}
              />
            </FilterRow>
            <FilterRow label="Payment">
              <AllSelect
                value={filters.paymentStatus ?? "ALL"}
                onValueChange={(v) => onChange({ paymentStatus: v as POFilters["paymentStatus"] })}
                allLabel="Any payment"
                options={PO_PAYMENT_STATUSES.map((s) => ({ value: s, label: PO_PAYMENT_STATUS_LABEL[s] }))}
              />
            </FilterRow>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FilterRow label="Material">
              <AllSelect
                value={filters.material ?? "ALL"}
                onValueChange={(v) => onChange({ material: v })}
                allLabel="Any material"
                options={materials.map((m) => ({ value: m, label: m }))}
              />
            </FilterRow>
            <FilterRow label="Category">
              <AllSelect
                value={filters.category ?? "ALL"}
                onValueChange={(v) => onChange({ category: v })}
                allLabel="Any category"
                options={categories.map((c) => ({ value: c, label: c }))}
              />
            </FilterRow>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FilterRow label="Created by">
              <AllSelect
                value={filters.createdById ?? "ALL"}
                onValueChange={(v) => onChange({ createdById: v })}
                allLabel="Anyone"
                options={members.map((m) => ({ value: m.id, label: m.fullName }))}
              />
            </FilterRow>
            <FilterRow label="GST">
              <AllSelect
                value={filters.gst ?? "ALL"}
                onValueChange={(v) => onChange({ gst: v as POGstFilter })}
                allLabel="Any"
                options={[
                  { value: "WITH", label: "With GST" },
                  { value: "WITHOUT", label: "Without GST" },
                ]}
              />
            </FilterRow>
          </div>

          <FilterRow label="Amount range">
            <div className="flex items-center gap-2">
              {/* A filter bound, not an amount to be paid — but it reads the
                  same numbers, so it groups the same way. */}
              <MoneyInput
                value={filters.amountMinPaise ?? null}
                onValueChange={(paise) => onChange({ amountMinPaise: paise ?? undefined })}
                placeholder="Min"
                aria-label="Minimum amount"
              />
              <span className="text-foreground-subtle">–</span>
              <MoneyInput
                value={filters.amountMaxPaise ?? null}
                onValueChange={(paise) => onChange({ amountMaxPaise: paise ?? undefined })}
                placeholder="Max"
                aria-label="Maximum amount"
              />
            </div>
          </FilterRow>

          <FilterRow label="Purchase date range">
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={filters.dateFrom ?? ""}
                max={filters.dateTo || undefined}
                onChange={(e) => onChange({ dateFrom: e.target.value || undefined })}
              />
              <span className="text-foreground-subtle">–</span>
              <Input
                type="date"
                value={filters.dateTo ?? ""}
                min={filters.dateFrom || undefined}
                onChange={(e) => onChange({ dateTo: e.target.value || undefined })}
              />
            </div>
          </FilterRow>
        </div>

        <SheetFooter>
          <Button type="button" variant="ghost" onClick={onClearAll}>Clear all</Button>
          <Button type="button" variant="primary" onClick={() => onOpenChange(false)}>Done</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
