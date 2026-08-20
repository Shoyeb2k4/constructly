"use client";

import * as React from "react";
import { Columns3, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoneyText } from "@/components/patterns/money-text";
import { StatusBadge, PO_STATUS_META, PO_PAYMENT_META } from "@/components/patterns/status-badge";
import { DataTable } from "@/components/patterns/data-table";
import { formatDate } from "@/features/projects/format";
import type { PurchaseOrderListItem } from "../types";

interface PoColumn {
  key: string;
  label: string;
  defaultWidth: number;
  minWidth: number;
  /** Locked columns can't be hidden. */
  locked?: boolean;
  align?: "left" | "right";
  /** Hidden by default (user can enable via the Columns menu). */
  optionalDefaultOff?: boolean;
  cell: (po: PurchaseOrderListItem) => React.ReactNode;
}

export const PO_COLUMNS: PoColumn[] = [
  {
    key: "po",
    label: "PO / Vendor",
    defaultWidth: 220,
    minWidth: 140,
    locked: true,
    cell: (po) => (
      <div className="min-w-0">
        <p className="truncate font-mono text-sm">{po.poNumber}</p>
        <p className="truncate text-xs text-foreground-subtle">{po.vendor.name}</p>
      </div>
    ),
  },
  { key: "project", label: "Project", defaultWidth: 160, minWidth: 90, cell: (po) => <span className="truncate text-sm text-foreground-muted">{po.project.name}</span> },
  { key: "date", label: "Purchased", defaultWidth: 120, minWidth: 90, cell: (po) => <span className="text-sm text-foreground-muted">{formatDate(po.purchaseDate)}</span> },
  { key: "delivery", label: "Expected", defaultWidth: 120, minWidth: 90, optionalDefaultOff: true, cell: (po) => <span className="text-sm text-foreground-muted">{po.expectedDelivery ? formatDate(po.expectedDelivery) : "—"}</span> },
  { key: "amount", label: "Amount", defaultWidth: 120, minWidth: 90, align: "right", cell: (po) => <span className="font-mono text-sm"><MoneyText paise={po.totalPaise} compact /></span> },
  { key: "gst", label: "GST", defaultWidth: 100, minWidth: 70, align: "right", optionalDefaultOff: true, cell: (po) => <span className="font-mono text-sm text-foreground-muted"><MoneyText paise={po.gstPaise} compact /></span> },
  { key: "paid", label: "Paid", defaultWidth: 110, minWidth: 80, align: "right", optionalDefaultOff: true, cell: (po) => <span className="font-mono text-sm text-foreground-muted"><MoneyText paise={po.paidPaise} compact /></span> },
  // A badge, not coloured text: payment state must be readable without relying
  // on colour, exactly like the order status beside it.
  { key: "payment", label: "Payment", defaultWidth: 120, minWidth: 90, cell: (po) => <StatusBadge meta={PO_PAYMENT_META} value={po.paymentStatus} /> },
  { key: "createdBy", label: "Created by", defaultWidth: 140, minWidth: 90, optionalDefaultOff: true, cell: (po) => <span className="truncate text-sm text-foreground-muted">{po.createdBy?.name ?? "—"}</span> },
  { key: "status", label: "Status", defaultWidth: 120, minWidth: 90, locked: true, cell: (po) => <StatusBadge meta={PO_STATUS_META} value={po.status} /> },
];

const STORAGE_KEY = "constructly.po-table.v1";

interface ColState {
  visible: Record<string, boolean>;
  widths: Record<string, number>;
}

function defaultColState(): ColState {
  const visible: Record<string, boolean> = {};
  const widths: Record<string, number> = {};
  for (const c of PO_COLUMNS) {
    visible[c.key] = !c.optionalDefaultOff;
    widths[c.key] = c.defaultWidth;
  }
  return { visible, widths };
}

/** Column visibility + widths, persisted to localStorage. */
export function usePoColumns() {
  const [state, setState] = React.useState<ColState>(defaultColState);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<ColState>;
      // Hydrate saved prefs post-mount (not in the initializer) to avoid an
      // SSR/client mismatch. Merge over defaults so new columns still appear.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState((d) => ({
        visible: { ...d.visible, ...(saved.visible ?? {}) },
        widths: { ...d.widths, ...(saved.widths ?? {}) },
      }));
    } catch {
      /* ignore corrupt prefs */
    }
  }, []);

  const persist = React.useCallback((next: ColState) => {
    setState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  }, []);

  const toggle = React.useCallback(
    (key: string) => persist({ ...state, visible: { ...state.visible, [key]: !state.visible[key] } }),
    [state, persist],
  );
  const setWidth = React.useCallback(
    (key: string, w: number) => persist({ ...state, widths: { ...state.widths, [key]: w } }),
    [state, persist],
  );
  const reset = React.useCallback(() => persist(defaultColState()), [persist]);

  return { state, toggle, setWidth, reset };
}

export function PoColumnsMenu({
  state,
  toggle,
  reset,
}: {
  state: ColState;
  toggle: (key: string) => void;
  reset: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm">
          <Columns3 className="size-4" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PO_COLUMNS.map((c) => {
          const on = state.visible[c.key];
          return (
            <DropdownMenuItem
              key={c.key}
              disabled={c.locked}
              onSelect={(e) => {
                e.preventDefault();
                if (!c.locked) toggle(c.key);
              }}
              className="justify-between"
            >
              {c.label}
              {on && <Check className="size-4 text-primary" />}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => reset()}>Reset to default</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The purchase-order list.
 *
 * This was a CSS-grid pseudo-table whose rows were `onClick` divs — no link, no
 * role, no `tabIndex`. A keyboard user could not open a purchase order at all,
 * and axe does not catch that shape. Moving onto the shared `DataTable` gives
 * real `<table>` semantics and a real link per row.
 *
 * Column VISIBILITY is kept — it is a genuine ERP affordance and the menu is
 * unchanged. Column RESIZING is not: it was mouse-only, had no keyboard path,
 * and its absence costs nothing that the responsive column rules do not already
 * handle better.
 */
export function PoTable({
  items,
  colState,
  onRowClick,
}: {
  items: PurchaseOrderListItem[];
  colState: ColState;
  /** Retained for callers that navigate imperatively; rows are links regardless. */
  onRowClick?: (id: string) => void;
}) {
  void onRowClick;
  const cols = PO_COLUMNS.filter((c) => colState.visible[c.key]);

  return (
    <DataTable
      caption="Purchase orders"
      rows={items}
      getRowKey={(po) => po.id}
      rowHref={(po) => `/procurement/${po.id}`}
      columns={cols.map((c) => ({
        key: c.key,
        header: c.label,
        numeric: c.align === "right",
        cell: c.cell,
      }))}
      // A phone gets the fields that decide whether to open a PO, not 38% of a
      // 860px row behind a horizontal scroller.
      renderCard={(po) => (
        <a
          href={`/procurement/${po.id}`}
          className="block rounded-xl border border-border bg-surface p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-sm font-medium">{po.poNumber}</p>
              <p className="text-xs text-foreground-subtle">{po.vendor.name}</p>
            </div>
            <span className="shrink-0 font-mono text-sm tabular-nums">
              <MoneyText paise={po.totalPaise} compact />
            </span>
          </div>
          <p className="mt-1.5 text-xs text-foreground-muted">{po.project.name}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge meta={PO_STATUS_META} value={po.status} />
            <StatusBadge meta={PO_PAYMENT_META} value={po.paymentStatus} />
            <span className="text-xs text-foreground-subtle">{formatDate(po.purchaseDate)}</span>
          </div>
        </a>
      )}
    />
  );
}
