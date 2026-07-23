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
import { StatusBadge, PO_STATUS_META } from "@/components/patterns/status-badge";
import { cn } from "@/lib/utils";
import { formatDate } from "@/features/projects/format";
import { PO_PAYMENT_STATUS_LABEL } from "../constants";
import type { PurchaseOrderListItem, POPaymentStatus } from "../types";

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

const PAY_TONE: Record<POPaymentStatus, string> = {
  PAID: "text-success-foreground",
  PARTIAL: "text-warning-foreground",
  UNPAID: "text-foreground-muted",
};

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
  { key: "payment", label: "Payment", defaultWidth: 120, minWidth: 90, cell: (po) => <span className={cn("text-xs font-medium", PAY_TONE[po.paymentStatus])}>{PO_PAYMENT_STATUS_LABEL[po.paymentStatus]}</span> },
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

export function PoTable({
  items,
  colState,
  setWidth,
  onRowClick,
}: {
  items: PurchaseOrderListItem[];
  colState: ColState;
  setWidth: (key: string, w: number) => void;
  onRowClick: (id: string) => void;
}) {
  const cols = PO_COLUMNS.filter((c) => colState.visible[c.key]);
  const template = cols.map((c) => `${colState.widths[c.key] ?? c.defaultWidth}px`).join(" ");
  const minWidth = cols.reduce((s, c) => s + (colState.widths[c.key] ?? c.defaultWidth), 0);

  const drag = React.useRef<{ key: string; startX: number; startW: number; min: number } | null>(null);

  function onResizeStart(e: React.MouseEvent, c: PoColumn) {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { key: c.key, startX: e.clientX, startW: colState.widths[c.key] ?? c.defaultWidth, min: c.minWidth };
    const onMove = (ev: MouseEvent) => {
      if (!drag.current) return;
      const w = Math.max(drag.current.min, drag.current.startW + (ev.clientX - drag.current.startX));
      setWidth(drag.current.key, Math.round(w));
    };
    const onUp = () => {
      drag.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.removeProperty("user-select");
    };
    document.body.style.setProperty("user-select", "none");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <div style={{ minWidth }}>
        {/* Header */}
        <div
          className="sticky top-0 z-10 grid items-center border-b border-border bg-surface-muted/60 text-xs font-medium text-foreground-subtle backdrop-blur"
          style={{ gridTemplateColumns: template }}
        >
          {cols.map((c, i) => (
            <div
              key={c.key}
              className={cn("relative h-10 px-4", i === 0 && "pl-4", "flex items-center", c.align === "right" && "justify-end")}
            >
              <span className="truncate">{c.label}</span>
              {i < cols.length - 1 && (
                <span
                  role="separator"
                  aria-orientation="vertical"
                  onMouseDown={(e) => onResizeStart(e, c)}
                  className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40"
                />
              )}
            </div>
          ))}
        </div>

        {/* Rows */}
        {items.map((po, r) => (
          <div
            key={po.id}
            onClick={() => onRowClick(po.id)}
            className={cn(
              "grid cursor-pointer items-center border-b border-border last:border-0 hover:bg-surface-muted/50",
              r % 2 === 1 && "bg-surface-muted/20",
            )}
            style={{ gridTemplateColumns: template }}
          >
            {cols.map((c) => (
              <div key={c.key} className={cn("min-w-0 px-4 py-3", c.align === "right" && "text-right")}>
                {c.cell(po)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
