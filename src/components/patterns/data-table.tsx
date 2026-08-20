"use client";

/**
 * The ERP table.
 *
 * Eleven screens hand-rolled their own with `grid-cols-[100px_1fr_140px]`, and
 * the drift showed: `/projects` ended up with `role="row"` on divs whose parent
 * had no table role and whose children had no cell role — 10 axe violations, and
 * worse than no ARIA at all, because a screen reader announces "row" with
 * nothing to anchor it to. Column widths were pixel constants, which is what
 * pushed money into neighbouring columns on small screens.
 *
 * Three rules shape this component:
 *
 * 1. NATIVE SEMANTICS. It renders a real `<table>`. No role juggling, headers
 *    carry `scope="col"`, and every table gets a caption (visually hidden by
 *    default) so it is announced with a name.
 *
 * 2. A CARD LIST IS NOT A TABLE. Below the breakpoint, `renderCard` swaps in an
 *    honest `<ul>` of list items rather than a grid pretending to be tabular.
 *    Faking table semantics in a stacked layout is the bug this replaces.
 *
 * 3. VIRTUALISATION MUST NOT COST SEMANTICS. `virtualize` windows the rows of an
 *    unbounded list while keeping real `<tr>`/`<td>`, using spacer rows for the
 *    scroll height and `aria-rowcount`/`aria-rowindex` to tell assistive tech
 *    the TRUE size and position rather than the window's.
 *
 * Deliberately not a data-grid platform: no sorting engine, no column resizing.
 * Those belong to the screens that actually need them.
 */

import * as React from "react";
import Link from "next/link";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export interface DataColumn<T> {
  /** Stable identity for React keys. */
  key: string;
  header: React.ReactNode;
  /** Renders the cell body. */
  cell: (row: T) => React.ReactNode;
  /**
   * Numeric/money column: right-aligned with tabular figures so digits line up
   * down the column and totals are comparable at a glance.
   */
  numeric?: boolean;
  /** Tailwind width utility, e.g. "w-40". Prefer leaving it to the browser. */
  width?: string;
  /** Drop the column on narrow viewports instead of letting it squeeze. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  /**
   * Column exists for controls (row actions) and has no meaningful heading. The
   * header text is still required and still rendered — for screen readers only.
   */
  headerHidden?: boolean;
}

const HIDE_BELOW: Record<NonNullable<DataColumn<unknown>["hideBelow"]>, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

export interface VirtualizeOptions {
  /** Row height estimate, in px. */
  estimateRowHeight: number;
  /** CSS max-height for the scroll viewport, e.g. "calc(100vh - 22rem)". */
  maxHeight: string;
}

export interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  /** Names the table for assistive tech. Hidden unless `showCaption`. */
  caption: string;
  showCaption?: boolean;
  /**
   * Makes each row open a record. The FIRST column becomes a real link, so the
   * row is reachable and announced by keyboard; the row-level click is a pointer
   * convenience on top of it, never the only way in.
   */
  rowHref?: (row: T) => string;
  isLoading?: boolean;
  loadingRows?: number;
  /** Shown instead of the table when there are no rows and none are loading. */
  empty?: React.ReactNode;
  /** Stacked representation below `md`. Without it the table scrolls sideways. */
  renderCard?: (row: T) => React.ReactNode;
  /** Window the rows of an unbounded list. See rule 3 above. */
  virtualize?: VirtualizeOptions;
  className?: string;
}

function cellClass<T>(col: DataColumn<T>) {
  return cn(
    "px-4 py-3 align-middle",
    col.numeric && "whitespace-nowrap text-right font-mono tabular-nums",
    col.hideBelow && HIDE_BELOW[col.hideBelow],
  );
}

function headerClass<T>(col: DataColumn<T>) {
  return cn(
    "px-4 py-2.5 text-xs font-medium text-foreground-muted",
    col.numeric ? "text-right" : "text-left",
    col.width,
    col.hideBelow && HIDE_BELOW[col.hideBelow],
  );
}

/** One row's cells, shared by the plain and windowed bodies. */
function RowCells<T>({
  row,
  columns,
  href,
}: {
  row: T;
  columns: DataColumn<T>[];
  href?: string;
}) {
  return (
    <>
      {columns.map((col, i) => (
        <td key={col.key} className={cellClass(col)}>
          {href && i === 0 ? (
            <Link
              href={href}
              className="block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              // The row already navigates; stop the row handler from firing a
              // second time on top of the link's own.
              onClick={(e) => e.stopPropagation()}
            >
              {col.cell(row)}
            </Link>
          ) : (
            col.cell(row)
          )}
        </td>
      ))}
    </>
  );
}

/**
 * Pointer convenience that FORWARDS to the row's own link rather than calling
 * the router, so there is exactly one navigation path — and the component stays
 * free of router context, which a table has no business requiring.
 */
const forwardToRowLink = (e: React.MouseEvent<HTMLTableRowElement>) =>
  e.currentTarget.querySelector("a")?.click();

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  caption,
  showCaption,
  rowHref,
  isLoading,
  loadingRows = 5,
  empty,
  renderCard,
  virtualize,
  className,
}: DataTableProps<T>) {
  if (isLoading) {
    return <TableSkeleton columns={columns} rows={loadingRows} caption={caption} />;
  }
  if (rows.length === 0 && empty) return <>{empty}</>;

  const table = virtualize ? (
    <VirtualTable
      columns={columns}
      rows={rows}
      getRowKey={getRowKey}
      caption={caption}
      showCaption={showCaption}
      rowHref={rowHref}
      virtualize={virtualize}
    />
  ) : (
    <table className="w-full border-collapse text-sm">
      <caption
        className={cn(showCaption ? "px-4 py-3 text-left text-sm text-foreground-muted" : "sr-only")}
      >
        {caption}
      </caption>
      <thead>
        <tr className="border-b border-border">
          {columns.map((col) => (
            <th key={col.key} scope="col" className={headerClass(col)}>
              <span className={cn(col.headerHidden && "sr-only")}>{col.header}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const href = rowHref?.(row);
          return (
            <tr
              key={getRowKey(row)}
              onClick={href ? forwardToRowLink : undefined}
              className={cn(
                "border-b border-border last:border-0",
                href && "cursor-pointer hover:bg-surface-muted",
              )}
            >
              <RowCells row={row} columns={columns} href={href} />
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  // A virtualised table owns its own scroll viewport; wrapping it in a second
  // one would nest scrollers.
  const wrap = (extra?: string) =>
    virtualize ? (
      <div className={cn("rounded-xl border border-border bg-surface", extra, className)}>
        {table}
      </div>
    ) : (
      <div
        // `relative` matters: `sr-only` is position:absolute, and without a
        // positioned ancestor its containing block is the page, so hidden
        // captions and headers inside a sideways-scrolled table escape the
        // scroller and widen the DOCUMENT — a horizontal page scrollbar caused
        // by text nobody can see.
        className={cn(
          "relative overflow-x-auto rounded-xl border border-border bg-surface",
          extra,
          className,
        )}
        // A sideways-scrolling region must be focusable to be keyboard-scrollable.
        tabIndex={0}
        role="region"
        aria-label={caption}
      >
        {table}
      </div>
    );

  if (!renderCard) return wrap();

  return (
    <>
      {/* Stacked list on small screens — a list, and marked up as one. */}
      <ul className={cn("space-y-2 md:hidden", className)} aria-label={caption}>
        {rows.map((row) => (
          <li key={getRowKey(row)}>{renderCard(row)}</li>
        ))}
      </ul>
      {wrap("hidden md:block")}
    </>
  );
}

/**
 * A windowed `<table>`.
 *
 * The scroll viewport wraps the table and `<thead>` is sticky, so column meaning
 * survives scrolling. Rows outside the window are represented by two spacer rows
 * carrying the missing height, which keeps the scrollbar honest without
 * absolutely positioning anything — absolute rows are exactly what made the
 * previous implementation abandon table markup and reach for `role="row"`.
 */
function VirtualTable<T>({
  columns,
  rows,
  getRowKey,
  caption,
  showCaption,
  rowHref,
  virtualize,
}: {
  columns: DataColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  caption: string;
  showCaption?: boolean;
  rowHref?: (row: T) => string;
  virtualize: VirtualizeOptions;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // TanStack Virtual returns non-memoizable functions; React Compiler skips it
  // safely here (the virtualizer manages its own state).
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => virtualize.estimateRowHeight,
    overscan: 10,
  });

  const items = virtualizer.getVirtualItems();
  const paddingTop = items.length > 0 ? items[0].start : 0;
  const paddingBottom =
    items.length > 0 ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;

  return (
    <div
      ref={scrollRef}
      className="relative overflow-auto"
      style={{ maxHeight: virtualize.maxHeight }}
      tabIndex={0}
      role="region"
      aria-label={caption}
    >
      <table
        className="w-full border-collapse text-sm"
        // The TRUE row count, not the window's. +1 because ARIA counts the
        // header row.
        aria-rowcount={rows.length + 1}
      >
        <caption
          className={cn(
            showCaption ? "px-4 py-3 text-left text-sm text-foreground-muted" : "sr-only",
          )}
        >
          {caption}
        </caption>
        <thead className="sticky top-0 z-10 bg-surface">
          <tr aria-rowindex={1} className="border-b border-border">
            {columns.map((col) => (
              <th key={col.key} scope="col" className={headerClass(col)}>
                <span className={cn(col.headerHidden && "sr-only")}>{col.header}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {paddingTop > 0 && (
            <tr aria-hidden="true">
              <td colSpan={columns.length} style={{ height: paddingTop }} />
            </tr>
          )}
          {items.map((item) => {
            const row = rows[item.index];
            const href = rowHref?.(row);
            return (
              <tr
                key={getRowKey(row)}
                // Position within the WHOLE list; +2 because the header is row 1
                // and aria-rowindex is 1-based.
                aria-rowindex={item.index + 2}
                onClick={href ? forwardToRowLink : undefined}
                className={cn(
                  "border-b border-border",
                  href && "cursor-pointer hover:bg-surface-muted",
                )}
              >
                <RowCells row={row} columns={columns} href={href} />
              </tr>
            );
          })}
          {paddingBottom > 0 && (
            <tr aria-hidden="true">
              <td colSpan={columns.length} style={{ height: paddingBottom }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Loading state built from the SAME column definitions, so the skeleton has the
 * table's real geometry and the page does not jump when data lands.
 */
function TableSkeleton<T>({
  columns,
  rows,
  caption,
}: {
  columns: DataColumn<T>[];
  rows: number;
  caption: string;
}) {
  return (
    <div className="relative rounded-xl border border-border bg-surface" aria-busy="true">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption} — loading</caption>
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th key={col.key} scope="col" className={headerClass(col)}>
                <span className={cn(col.headerHidden && "sr-only")}>{col.header}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className="border-b border-border last:border-0">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn("px-4 py-3", col.hideBelow && HIDE_BELOW[col.hideBelow])}
                >
                  <Skeleton className={cn("h-4", col.numeric ? "ml-auto w-20" : "w-32")} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
