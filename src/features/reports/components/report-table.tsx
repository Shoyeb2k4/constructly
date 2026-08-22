"use client";

/**
 * A report's rows, on the shared `DataTable`.
 *
 * Reports was the last dense-table cluster still outside the design system —
 * a hand-rolled `<table>` with no caption, no `scope="col"`, no responsive
 * representation and rows that navigated on a div `onClick`. This puts it on
 * the same component every other list uses, which brings real semantics, a
 * card fallback below `md`, and keyboard-reachable row links for free.
 *
 * Two things a report table needs that an ordinary list does not: GROUP rows
 * (a category heading spanning the width) and TOTAL rows (the folded figure
 * someone else computed). Both are rendered here rather than pushed into
 * `DataTable`, because they are a reporting idea, not a table idea.
 */

import * as React from "react";
import Link from "next/link";
import { DataTable, type DataColumn } from "@/components/patterns/data-table";
import { MoneyText } from "@/components/patterns/money-text";
import { formatDate } from "@/features/projects/format";
import { cn } from "@/lib/utils";
import type { ReportColumn, ReportResult, ReportRow } from "../types";

/** Above this many rows the table windows itself — see the phase performance note. */
const VIRTUALIZE_ABOVE = 200;

function Cell({ value, col }: { value: string | number | null; col: ReportColumn }) {
  if (value == null || value === "") return <span className="text-foreground-subtle">—</span>;
  // Money is never rounded and never wraps; the layout yields instead.
  if (col.kind === "money") return <MoneyText paise={Number(value)} />;
  if (col.kind === "date") return <span className="whitespace-nowrap">{formatDate(String(value))}</span>;
  return <span className="block truncate">{value}</span>;
}

/**
 * Group and total rows carry no per-column data, so they are lifted out of the
 * table body and rendered as their own full-width rows. A group heading spread
 * across ten columns would be unreadable, and a screen reader would announce it
 * as nine empty cells.
 */
type Section =
  | { kind: "group"; label: string }
  | { kind: "rows"; rows: ReportRow[] }
  | { kind: "total"; row: ReportRow };

function toSections(rows: ReportRow[]): Section[] {
  const out: Section[] = [];
  let bucket: ReportRow[] = [];
  const flush = () => {
    if (bucket.length) out.push({ kind: "rows", rows: bucket });
    bucket = [];
  };
  for (const row of rows) {
    if (row.kind === "group") {
      flush();
      out.push({ kind: "group", label: String(row.cells.find((c) => c != null && c !== "") ?? "") });
    } else if (row.kind === "total") {
      flush();
      out.push({ kind: "total", row });
    } else {
      bucket.push(row);
    }
  }
  flush();
  return out;
}

export function ReportTable({ result }: { result: ReportResult }) {
  const columns: DataColumn<ReportRow>[] = React.useMemo(
    () =>
      result.columns.map((col, i) => ({
        key: col.key,
        header: col.label,
        numeric: col.kind === "money" || col.kind === "number" || col.align === "right",
        hideBelow: col.hideBelow,
        cell: (row) => <Cell value={row.cells[i]} col={col} />,
      })),
    [result.columns],
  );

  const sections = React.useMemo(() => toSections(result.rows), [result.rows]);
  const dataRowCount = result.rows.filter((r) => r.kind !== "group" && r.kind !== "total").length;

  const renderCard = React.useCallback(
    (row: ReportRow) => {
      // The first column identifies the row; the last money column is the one
      // figure a phone reader is looking for. Everything else stacks as labelled
      // pairs rather than being squeezed into invisible columns.
      const primary = result.columns[0];
      const moneyIdx = result.columns.map((c, i) => (c.kind === "money" ? i : -1)).filter((i) => i >= 0);
      const headline = moneyIdx.length ? moneyIdx[moneyIdx.length - 1] : -1;
      const rest = result.columns
        .map((c, i) => ({ c, i }))
        .filter(({ i }) => i !== 0 && i !== headline);

      const body = (
        <>
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0 flex-1 font-medium">
              <Cell value={row.cells[0]} col={primary} />
            </span>
            {headline >= 0 && (
              <span className="shrink-0 font-medium">
                <Cell value={row.cells[headline]} col={result.columns[headline]} />
              </span>
            )}
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {rest.map(({ c, i }) => {
              const v = row.cells[i];
              if (v == null || v === "") return null;
              return (
                <div key={c.key} className="flex min-w-0 items-baseline justify-between gap-2">
                  <dt className="min-w-0 truncate text-foreground-subtle">{c.label}</dt>
                  <dd className="shrink-0 text-foreground-muted">
                    <Cell value={v} col={c} />
                  </dd>
                </div>
              );
            })}
          </dl>
        </>
      );

      return (
        <div className="min-w-0 rounded-xl border border-border bg-surface p-4">
          {row.href ? (
            <Link
              href={row.href}
              className="block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {body}
            </Link>
          ) : (
            body
          )}
        </div>
      );
    },
    [result.columns],
  );

  return (
    <div className="space-y-3">
      {sections.map((section, i) => {
        if (section.kind === "group") {
          return (
            <h3
              key={`g-${i}`}
              className="px-1 pt-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted"
            >
              {section.label}
            </h3>
          );
        }
        if (section.kind === "total") {
          return <TotalRow key={`t-${i}`} row={section.row} columns={result.columns} />;
        }
        return (
          <DataTable
            key={`r-${i}`}
            columns={columns}
            rows={section.rows}
            getRowKey={(row) => String(row.cells[0]) + String(row.cells[1] ?? "")}
            caption={`${result.title} — ${result.periodLabel}`}
            rowHref={(row) => row.href ?? ""}
            renderCard={renderCard}
            virtualize={
              dataRowCount > VIRTUALIZE_ABOVE
                ? { estimateRowHeight: 48, maxHeight: "calc(100vh - 26rem)" }
                : undefined
            }
          />
        );
      })}
    </div>
  );
}

/**
 * A folded figure, rendered as a labelled strip rather than a table row.
 *
 * The number is not recomputed here — the report handed it over already folded
 * by whichever module owns the arithmetic.
 */
function TotalRow({ row, columns }: { row: ReportRow; columns: ReportColumn[] }) {
  const label = row.cells.find((c, i) => columns[i]?.kind !== "money" && c != null && c !== "");
  const figures = columns
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => (c.kind === "money" || c.kind === "number") && row.cells[i] != null && row.cells[i] !== "");

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 rounded-xl border border-border bg-surface-muted/50 px-4 py-3">
      <span className="text-sm font-medium">{String(label ?? "Total")}</span>
      <dl className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1">
        {figures.map(({ c, i }) => (
          <div key={c.key} className="flex items-baseline gap-2">
            <dt className="text-xs text-foreground-subtle">{c.label}</dt>
            <dd className={cn("text-sm font-medium", c.kind === "money" && "font-mono tabular-nums")}>
              <Cell value={row.cells[i]} col={c} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
