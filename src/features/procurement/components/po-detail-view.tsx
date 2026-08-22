"use client";

import { GovernedDeleteDialog } from "@/features/governance/components/governed-delete-dialog";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Send, Check, Pencil, Trash2, ShoppingCart, CopyPlus, IndianRupee, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/patterns/empty-state";
import { MoneyText } from "@/components/patterns/money-text";
import { StatusBadge, PO_STATUS_META, PO_PAYMENT_META } from "@/components/patterns/status-badge";
import { PageHeader } from "@/components/patterns/page-header";
import { Callout } from "@/components/patterns/callout";
import { DataTable } from "@/components/patterns/data-table";
import { FinancialGrid, FinancialLine } from "@/components/patterns/financial-grid";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDate } from "@/features/projects/format";
import { usePurchaseOrder, usePOMutations } from "../hooks";
import { useCan } from "@/features/rbac/permission-context";
import { CopyableRef, PaymentModeChip, PaymentStatusBadge } from "./payment-bits";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { POEditorSheet } from "./po-editor-sheet";

export function PODetailView({ id }: { id: string }) {
  const router = useRouter();
  const can = useCan();
  const { data: po, isLoading } = usePurchaseOrder(id);
  const { submit, approve, duplicate, remove } = usePOMutations();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [payOpen, setPayOpen] = React.useState(false);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  if (!po) {
    return (
      <EmptyState
        icon={ShoppingCart}
        title="Purchase order not found"
        description="It may have been deleted, or you don't have access."
        action={<Button asChild variant="secondary" size="sm"><Link href="/procurement">Back to procurement</Link></Button>}
      />
    );
  }

  const approved = po.status === "APPROVED";
  // Permission + status: editing needs purchase_orders.edit; a non-DRAFT PO also
  // needs the broad purchase_orders.edit_all. (Server enforces the same + project
  // ownership; the visible set is already scoped to the caller's POs.)
  const canEditAction = can("purchase_orders.edit");
  const canEdit = canEditAction && (po.status === "DRAFT" || can("purchase_orders.edit_all"));

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <ol className="flex items-center gap-1 text-foreground-muted">
          <li>
            <Link href="/procurement" className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Procurement
            </Link>
          </li>
          <ChevronRight className="size-3.5 text-foreground-subtle" aria-hidden="true" />
          <li className="font-mono text-xs">{po.poNumber}</li>
        </ol>
      </nav>

      {/* Order state and payment state are shown as SEPARATE badges because they
          are separate facts: an approved order can sit unpaid for weeks, and
          collapsing them into one "state" is how a commitment gets mistaken for
          cash that has left. */}
      <PageHeader
        title={
          <>
            <span className="font-mono">{po.poNumber}</span>
            <StatusBadge meta={PO_STATUS_META} value={po.status} />
            <StatusBadge meta={PO_PAYMENT_META} value={po.paymentStatus} />
          </>
        }
        meta={
          <>
            <Link href={`/vendors/${po.vendor.id}`} className="rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {po.vendor.name}
            </Link>
            <span aria-hidden="true">·</span>
            <Link href={`/projects/${po.project.id}`} className="rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {po.project.name}
            </Link>
            <span aria-hidden="true">·</span>
            <span>{formatDate(po.purchaseDate)}</span>
            {po.revisedFromNumber && (
              <>
                <span aria-hidden="true">·</span>
                <span>Revised from {po.revisedFromNumber}</span>
              </>
            )}
          </>
        }
        actions={
          <>
            {/* One primary, chosen by where the order actually is in its
                lifecycle — not six buttons of equal weight. */}
            {po.status === "DRAFT" && canEditAction && (
              <Button variant="primary" onClick={() => submit.mutate(po.id)} disabled={submit.isPending}>
                <Send />
                Submit for approval
              </Button>
            )}
            {po.status === "SUBMITTED" && can("purchase_orders.approve") && (
              <Button variant="primary" onClick={() => approve.mutate(po.id)} disabled={approve.isPending}>
                <Check />
                Approve
              </Button>
            )}
            {approved && can("payments.create") && (
              <Button variant="primary" onClick={() => setPayOpen(true)}>
                <IndianRupee />
                Record payment
              </Button>
            )}
            {canEdit && (
              <Button variant="secondary" onClick={() => setEditOpen(true)}>
                <Pencil />
                Edit
              </Button>
            )}
            {(can("purchase_orders.create") || can("purchase_orders.delete")) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="More purchase order actions">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {can("purchase_orders.create") && (
                    <DropdownMenuItem
                      disabled={duplicate.isPending}
                      onSelect={() =>
                        duplicate.mutate(po.id, {
                          onSuccess: (p) => router.push(`/procurement/${p.id}`),
                        })
                      }
                    >
                      <CopyPlus />
                      Duplicate as draft
                    </DropdownMenuItem>
                  )}
                  {can("purchase_orders.delete") && (
                    <>
                      <DropdownMenuSeparator />
                      {po.payments.length === 0 ? (
                        <DropdownMenuItem
                          className="text-danger-foreground"
                          onSelect={() => setConfirmDelete(true)}
                        >
                          <Trash2 />
                          Delete purchase order
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem disabled className="flex-col items-start gap-0.5">
                          <span className="flex items-center gap-2">
                            <Trash2 className="size-4" />
                            Delete purchase order
                          </span>
                          <span className="pl-6 text-xs text-foreground-subtle">
                            Paid against — the order stays
                          </span>
                        </DropdownMenuItem>
                      )}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      {/* Why an action is unavailable, stated once rather than inferred from a
          missing button. */}
      {po.status !== "DRAFT" && canEditAction && !can("purchase_orders.edit_all") && (
        <Callout tone="neutral" title="This order can no longer be edited here">
          It has been submitted for approval. Editing a submitted or approved order needs the
          broader purchase-order permission, so the record stays trustworthy once it is in the
          approval chain.
        </Callout>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Line items</CardTitle></CardHeader>
          <CardContent className="p-0">
            <DataTable
              caption={`Line items on ${po.poNumber}`}
              rows={po.lineItems}
              getRowKey={(l) => l.id}
              className="rounded-none border-0"
              columns={[
                {
                  key: "material",
                  header: "Material",
                  cell: (l) => (
                    <span className="block min-w-0">
                      <span className="block font-medium">{l.material}</span>
                      {l.category && (
                        <span className="block text-xs text-foreground-subtle">{l.category}</span>
                      )}
                    </span>
                  ),
                },
                {
                  key: "qty",
                  header: "Qty",
                  numeric: true,
                  cell: (l) => (
                    <span className="text-foreground-muted">
                      {l.quantity} <span className="font-sans">{l.unit}</span>
                    </span>
                  ),
                },
                {
                  key: "rate",
                  header: "Rate",
                  numeric: true,
                  cell: (l) => (
                    <span className="text-foreground-muted">
                      <MoneyText paise={l.ratePaise} whole />
                    </span>
                  ),
                },
                {
                  key: "gst",
                  header: "GST",
                  numeric: true,
                  hideBelow: "sm",
                  cell: (l) => (
                    <span className="text-foreground-muted">{l.gstRateBps / 100}%</span>
                  ),
                },
                {
                  key: "amount",
                  header: "Amount",
                  numeric: true,
                  cell: (l) => <MoneyText paise={l.amountPaise} whole />,
                },
              ]}
              renderCard={(l) => (
                <div className="rounded-xl border border-border bg-surface p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 font-medium">{l.material}</span>
                    <span className="shrink-0 font-mono tabular-nums">
                      <MoneyText paise={l.amountPaise} whole />
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-foreground-muted">
                    {l.quantity} {l.unit} × <MoneyText paise={l.ratePaise} whole /> · GST{" "}
                    {l.gstRateBps / 100}%
                  </p>
                  {l.category && (
                    <p className="text-xs text-foreground-subtle">{l.category}</p>
                  )}
                </div>
              )}
            />
            {/* The order's own arithmetic, in the shared financial layout —
                subtotal and GST make the grand total, and the grand total is
                what was ORDERED, not what has been paid. */}
            <div className="border-t border-border px-5 py-3">
              <FinancialGrid className="sm:grid-cols-1 xl:grid-cols-1">
                <FinancialLine label="Subtotal" paise={po.subtotalPaise} />
                <FinancialLine label="GST" paise={po.gstPaise} />
                <FinancialLine label="Grand total (ordered)" paise={po.totalPaise} strong />
              </FinancialGrid>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="divide-y divide-border py-0 text-sm">
              <Row label="Vendor" value={<Link href={`/vendors/${po.vendor.id}`} className="text-primary hover:underline">{po.vendor.name}</Link>} />
              <Row label="Project" value={<Link href={`/projects/${po.project.id}`} className="text-primary hover:underline">{po.project.name}</Link>} />
              <Row label="Date" value={formatDate(po.purchaseDate)} />
              <Row label="Expected delivery" value={po.expectedDelivery ? formatDate(po.expectedDelivery) : "—"} />
              <Row label="Invoice #" value={po.invoiceNumber ?? "—"} />
              <Row label="Created by" value={po.createdByName} />
              <Row label="Payment" value={<PaymentStatusBadge status={po.paymentStatus} />} />
            </CardContent>
          </Card>

          {/* MONEY, kept apart from the order's own details. "Ordered" is the
              commitment, "Paid" is cash that has actually moved, and the
              difference is what is still owed on this order — three different
              facts that must never share one label. */}
          <Card>
            <CardHeader><CardTitle>Money</CardTitle></CardHeader>
            <CardContent>
              <FinancialGrid className="sm:grid-cols-1 xl:grid-cols-1">
                <FinancialLine label="Ordered" paise={po.totalPaise} />
                <FinancialLine label="Paid" paise={po.paidPaise} />
                <FinancialLine
                  label="Still owed"
                  paise={po.totalPaise - po.paidPaise}
                  strong
                  tone={po.totalPaise - po.paidPaise > 0 ? "text-warning-foreground" : undefined}
                />
              </FinancialGrid>
              <p className="mt-2 text-xs text-foreground-subtle">
                Ordered is what this purchase order commits to. Paid is what has been recorded
                against it. Neither says anything about delivery.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
            <CardContent className="py-0">
              {po.payments.length === 0 ? (
                <p className="py-4 text-sm text-foreground-subtle">
                  No payments linked to this PO yet.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {po.payments.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                      <div className="min-w-0">
                        <div className="font-mono font-medium"><MoneyText paise={p.amountPaise} /></div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <PaymentModeChip mode={p.paymentMode} />
                          <CopyableRef value={p.referenceNumber} />
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-foreground-subtle">{formatDate(p.date)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <RecordPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        defaultVendorId={po.vendor.id}
        defaultProjectId={po.project.id}
        defaultPurchaseOrderId={po.id}
      />

      <POEditorSheet open={editOpen} onOpenChange={setEditOpen} editPo={po} />

      {/* The server refuses to delete an order that has been paid against, so
          the dialog shows the reason rather than a button that would fail. */}
      <GovernedDeleteDialog
        entity="purchaseOrder"
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        subject={`${po.poNumber} · ${po.vendor.name}`}
        blockedReason={
          po.payments.length > 0
            ? `${po.payments.length === 1 ? "A payment has" : `${po.payments.length} payments have`} been recorded against this order.`
            : null
        }
        onConfirm={
          po.payments.length > 0
            ? undefined
            : () => remove.mutate(po.id, { onSuccess: () => router.push("/procurement") })
        }
        pending={remove.isPending}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-foreground-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
