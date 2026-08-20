"use client";

import * as React from "react";
import Link from "next/link";
import {
  IndianRupee,
  Wallet,
  TrendingUp,
  ShoppingCart,
  Users,
  AlertTriangle,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MoneyText } from "@/components/patterns/money-text";
import { StatusBadge, PO_STATUS_META, PO_PAYMENT_META } from "@/components/patterns/status-badge";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { cn } from "@/lib/utils";
import { formatDate } from "@/features/projects/format";
import type { PurchaseOrderListItem, VendorPaymentItem } from "../types";
import { useProjectProcurement } from "../hooks";
import { useCan } from "@/features/rbac/permission-context";
import { POEditorSheet } from "./po-editor-sheet";
import { RecordPaymentDialog } from "./record-payment-dialog";

function SummaryCard({
  icon: Icon,
  label,
  children,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
  tone?: "warning";
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-xs text-foreground-subtle">
        <Icon className={cn("size-3.5", tone === "warning" && "text-warning")} />
        {label}
      </div>
      <div className={cn("mt-1.5 text-lg font-semibold", tone === "warning" && "text-warning-foreground")}>
        {children}
      </div>
    </div>
  );
}

export function ProjectProcurementTab({ projectId }: { projectId: string }) {
  const can = useCan();
  const { data, isLoading } = useProjectProcurement(projectId);
  const [poOpen, setPoOpen] = React.useState(false);
  const [payOpen, setPayOpen] = React.useState(false);
  /** Drill-in: show only one vendor's transactions for this project. */
  const [vendorFocus, setVendorFocus] = React.useState<string | null>(null);

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  const s = data.summary;
  const overBudget = s.remainingPaise != null && s.remainingPaise < 0;
  const focusVendor = vendorFocus ? data.vendors.find((v) => v.vendor.id === vendorFocus) : null;
  const focusPOs = vendorFocus ? data.purchaseOrders.filter((p) => p.vendor.id === vendorFocus) : data.purchaseOrders;
  const focusPayments = vendorFocus ? data.payments.filter((p) => p.vendor.id === vendorFocus) : data.payments;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground-muted">Purchasing center</h3>
        <div className="flex gap-2">
          {can("payments.create") && (
            <Button variant="secondary" size="sm" onClick={() => setPayOpen(true)}>
              <IndianRupee />
              Record payment
            </Button>
          )}
          {can("purchase_orders.create") && (
            <Button variant="primary" size="sm" onClick={() => setPoOpen(true)}>
              <Plus />
              New PO
            </Button>
          )}
        </div>
      </div>

      {/* Six summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <SummaryCard icon={Wallet} label="Procurement budget">
          {s.procurementBudgetPaise == null ? (
            <span className="text-sm font-normal text-foreground-subtle">Not set</span>
          ) : (
            <MoneyText paise={s.procurementBudgetPaise} compact />
          )}
        </SummaryCard>
        <SummaryCard icon={TrendingUp} label="Spent">
          <MoneyText paise={s.spentPaise} compact />
        </SummaryCard>
        <SummaryCard icon={Wallet} label="Remaining" tone={overBudget ? "warning" : undefined}>
          {s.remainingPaise == null ? (
            <span className="text-sm font-normal text-foreground-subtle">—</span>
          ) : (
            <MoneyText paise={s.remainingPaise} compact />
          )}
        </SummaryCard>
        <SummaryCard icon={ShoppingCart} label="Purchase orders">{s.poCount}</SummaryCard>
        <SummaryCard icon={Users} label="Vendors used">{s.vendorsUsed}</SummaryCard>
        <SummaryCard icon={AlertTriangle} label="Outstanding" tone={s.outstandingPaise > 0 ? "warning" : undefined}>
          <MoneyText paise={Math.max(0, s.outstandingPaise)} compact />
        </SummaryCard>
      </div>

      {overBudget && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-subtle/50 px-3 py-2 text-sm text-warning-foreground">
          <AlertTriangle className="size-4" />
          Procurement spend is over the dedicated budget — allowed, but worth a look.
        </div>
      )}

      {/* Vendors involved */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Vendors involved</CardTitle>
          {vendorFocus && (
            <button onClick={() => setVendorFocus(null)} className="text-xs text-primary hover:underline">
              Clear filter
            </button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {data.vendors.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-foreground-subtle">
              No vendors yet — create a purchase order to get started.
            </p>
          ) : (
            <>
              <div className="hidden grid-cols-[1fr_120px_90px_110px_110px_110px] gap-2 border-b border-border px-5 py-2 text-xs text-foreground-subtle sm:grid">
                <span>Vendor</span><span>Materials</span><span className="text-right">POs</span><span className="text-right">Purchase value</span><span className="text-right">Outstanding</span><span className="text-right">Last supply</span>
              </div>
              {data.vendors.map((r) => (
                <div
                  key={r.vendor.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setVendorFocus(r.vendor.id === vendorFocus ? null : r.vendor.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") setVendorFocus(r.vendor.id === vendorFocus ? null : r.vendor.id); }}
                  className={cn(
                    "grid cursor-pointer grid-cols-2 items-center gap-2 border-b border-border px-5 py-3 text-sm transition-colors last:border-0 hover:bg-surface-muted/40 sm:grid-cols-[1fr_120px_90px_110px_110px_110px]",
                    r.vendor.id === vendorFocus && "bg-primary/5",
                  )}
                >
                  <span className="min-w-0">
                    <Link
                      href={`/vendors/${r.vendor.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="block truncate font-medium text-primary hover:underline"
                    >
                      {r.vendor.name}
                    </Link>
                  </span>
                  <span className="truncate text-xs text-foreground-subtle">{r.materials.slice(0, 2).join(", ") || "—"}</span>
                  <span className="text-right text-foreground-muted">{r.poCount}</span>
                  <span className="text-right font-mono"><MoneyText paise={r.purchaseValuePaise} compact /></span>
                  <span className={cn("text-right font-mono", r.outstandingPaise > 0 && "text-warning-foreground")}>
                    <MoneyText paise={Math.max(0, r.outstandingPaise)} compact />
                  </span>
                  <span className="text-right text-xs text-foreground-muted">{r.lastSupplyDate ? formatDate(r.lastSupplyDate) : "—"}</span>
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>

      {/* Scoped POs + payments. Two lists, never merged: an order is a
          commitment and a payment is cash that has moved. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{focusVendor ? `${focusVendor.vendor.name} — orders` : "Purchase orders"}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              caption="Purchase orders on this project"
              rows={focusPOs as PurchaseOrderListItem[]}
              getRowKey={(po) => po.id}
              rowHref={(po) => `/procurement/${po.id}`}
              className="rounded-none border-0"
              empty={
                <EmptyState
                  icon={ShoppingCart}
                  title="No purchase orders yet"
                  description="Raise one to start tracking what this project buys."
                />
              }
              columns={[
                {
                  key: "po",
                  header: "PO",
                  cell: (po) => (
                    <span className="block min-w-0">
                      <span className="block font-mono text-sm">{po.poNumber}</span>
                      <span className="text-xs text-foreground-subtle">{po.vendor.name}</span>
                    </span>
                  ),
                },
                {
                  key: "status",
                  header: "Status",
                  cell: (po) => (
                    <span className="flex flex-wrap gap-1">
                      <StatusBadge meta={PO_STATUS_META} value={po.status} />
                      <StatusBadge meta={PO_PAYMENT_META} value={po.paymentStatus} />
                    </span>
                  ),
                },
                {
                  key: "amount",
                  header: "Ordered",
                  numeric: true,
                  cell: (po) => <MoneyText paise={po.totalPaise} compact />,
                },
              ]}
              renderCard={(po) => (
                <Link
                  href={`/procurement/${po.id}`}
                  className="block rounded-xl border border-border bg-surface p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-sm">{po.poNumber}</span>
                    <span className="shrink-0 font-mono tabular-nums">
                      <MoneyText paise={po.totalPaise} compact />
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-foreground-subtle">
                    {po.vendor.name} · {formatDate(po.purchaseDate)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <StatusBadge meta={PO_STATUS_META} value={po.status} />
                    <StatusBadge meta={PO_PAYMENT_META} value={po.paymentStatus} />
                  </div>
                </Link>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{focusVendor ? `${focusVendor.vendor.name} — payments` : "Payments"}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              caption="Vendor payments on this project"
              rows={focusPayments as VendorPaymentItem[]}
              getRowKey={(p) => p.id}
              className="rounded-none border-0"
              empty={
                <EmptyState
                  icon={IndianRupee}
                  title="No payments recorded yet"
                  description="Payments recorded against this project's vendors appear here."
                />
              }
              columns={[
                {
                  key: "amount",
                  header: "Amount",
                  numeric: true,
                  cell: (p) => <MoneyText paise={p.amountPaise} compact />,
                },
                {
                  key: "against",
                  header: "Against",
                  cell: (p) => (
                    <span className="block min-w-0">
                      <span className="block text-sm">{p.vendor.name}</span>
                      {/* An "on account" payment is not attached to any order —
                          say which, rather than leaving the row ambiguous. */}
                      {p.purchaseOrder ? (
                        <Link
                          href={`/procurement/${p.purchaseOrder.id}`}
                          className="rounded-sm font-mono text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {p.purchaseOrder.poNumber}
                        </Link>
                      ) : (
                        <span className="text-xs text-foreground-subtle">On account</span>
                      )}
                    </span>
                  ),
                },
                {
                  key: "date",
                  header: "Date",
                  hideBelow: "sm",
                  cell: (p) => (
                    <span className="whitespace-nowrap text-xs text-foreground-muted">
                      {formatDate(p.date)}
                    </span>
                  ),
                },
              ]}
              renderCard={(p) => (
                <div className="rounded-xl border border-border bg-surface p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono font-medium tabular-nums">
                      <MoneyText paise={p.amountPaise} compact />
                    </span>
                    <span className="shrink-0 text-xs text-foreground-subtle">
                      {formatDate(p.date)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-foreground-muted">
                    {p.vendor.name}
                    {p.purchaseOrder ? ` · ${p.purchaseOrder.poNumber}` : " · On account"}
                  </p>
                </div>
              )}
            />
          </CardContent>
        </Card>
      </div>

      <POEditorSheet open={poOpen} onOpenChange={setPoOpen} defaultProjectId={projectId} />
      <RecordPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        defaultProjectId={projectId}
        defaultVendorId={vendorFocus ?? undefined}
      />
    </div>
  );
}
