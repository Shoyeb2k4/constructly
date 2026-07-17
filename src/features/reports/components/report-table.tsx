"use client";

import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { MoneyText } from "@/components/patterns/money-text";
import { cn } from "@/lib/utils";
import type { ReportColumn, ReportResult, ReportRow } from "../types";

function alignOf(col: ReportColumn): string {
  return (col.align ?? (col.kind === "money" || col.kind === "number" ? "right" : "left")) === "right"
    ? "text-right"
    : "text-left";
}

function Cell({ value, col }: { value: string | number | null; col: ReportColumn }) {
  if (value == null || value === "") return <span className="text-foreground-subtle">—</span>;
  if (col.kind === "money") return <MoneyText paise={Number(value)} compact />;
  return <>{value}</>;
}

export function ReportTable({ result }: { result: ReportResult }) {
  const router = useRouter();
  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted/40">
              {result.columns.map((c) => (
                <th key={c.key} className={cn("px-4 py-2.5 text-xs font-medium text-foreground-subtle", alignOf(c))}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <Row key={i} row={row} columns={result.columns} onClick={row.href ? () => router.push(row.href!) : undefined} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Row({
  row,
  columns,
  onClick,
}: {
  row: ReportRow;
  columns: ReportColumn[];
  onClick?: () => void;
}) {
  if (row.kind === "group") {
    const label = row.cells.find((c) => c != null && c !== "");
    return (
      <tr className="bg-surface-muted/60">
        <td colSpan={columns.length} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          {String(label ?? "")}
        </td>
      </tr>
    );
  }
  return (
    <tr
      onClick={onClick}
      className={cn(
        "border-b border-border last:border-0",
        row.kind === "total" && "bg-surface-muted/30 font-medium",
        onClick && "cursor-pointer hover:bg-surface-muted/40",
      )}
    >
      {columns.map((c, i) => (
        <td key={c.key} className={cn("px-4 py-2.5 tabular-nums", alignOf(c), c.kind === "money" && "font-mono")}>
          <Cell value={row.cells[i]} col={c} />
        </td>
      ))}
    </tr>
  );
}
