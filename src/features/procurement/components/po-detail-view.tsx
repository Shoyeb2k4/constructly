"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Send, Check, Pencil, Trash2, ShoppingCart, CopyPlus, IndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/patterns/empty-state";
import { MoneyText } from "@/components/patterns/money-text";
import { StatusBadge, PO_STATUS_META } from "@/components/patterns/status-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <nav className="flex items-center gap-1 text-sm text-foreground-subtle">
            <Link href="/procurement" className="hover:text-foreground">Procurement</Link>
            <ChevronRight className="size-3.5" />
            <span className="font-mono text-xs">{po.poNumber}</span>
          </nav>
          <div className="mt-1 flex items-center gap-2.5">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{po.poNumber}</h1>
            <StatusBadge meta={PO_STATUS_META} value={po.status} />
          </div>
          {po.revisedFromNumber && (
            <p className="mt-1 text-xs text-foreground-subtle">Revised from {po.revisedFromNumber}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
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
          {approved && (
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
          {can("purchase_orders.create") && (
            <Button
              variant="ghost"
              onClick={() => duplicate.mutate(po.id, { onSuccess: (p) => router.push(`/procurement/${p.id}`) })}
              disabled={duplicate.isPending}
              title="Clone as a new draft dated today"
            >
              <CopyPlus />
              Duplicate
            </Button>
          )}
          {can("purchase_orders.delete") && (
            <Button
              variant="ghost"
              size="icon"
              className="text-danger-foreground"
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete"
              title="Delete"
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Line items</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-[1fr_70px_90px_64px_100px] gap-2 border-b border-border px-5 py-2 text-xs text-foreground-subtle">
              <span>Material</span><span>Qty</span><span>Rate</span><span>GST</span><span className="text-right">Amount</span>
            </div>
            {po.lineItems.map((l) => (
              <div key={l.id} className="grid grid-cols-[1fr_70px_90px_64px_100px] gap-2 border-b border-border px-5 py-3 text-sm last:border-0">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{l.material}</span>
                  {l.category && <span className="block truncate text-xs text-foreground-subtle">{l.category}</span>}
                </span>
                <span className="text-foreground-muted">{l.quantity} {l.unit}</span>
                <span className="font-mono text-foreground-muted"><MoneyText paise={l.ratePaise} whole /></span>
                <span className="text-foreground-muted">{l.gstRateBps / 100}%</span>
                <span className="text-right font-mono"><MoneyText paise={l.amountPaise} whole /></span>
              </div>
            ))}
            <div className="space-y-1 px-5 py-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground-muted">Subtotal</span>
                <span className="font-mono tabular-nums"><MoneyText paise={po.subtotalPaise} /></span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground-muted">GST</span>
                <span className="font-mono tabular-nums"><MoneyText paise={po.gstPaise} /></span>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-sm font-medium">Grand total</span>
                <span className="text-lg font-semibold"><MoneyText paise={po.totalPaise} /></span>
              </div>
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
              {po.paidPaise > 0 && (
                <Row label="Paid" value={<MoneyText paise={po.paidPaise} />} />
              )}
              {approved && po.totalPaise - po.paidPaise > 0 && (
                <Row label="Outstanding" value={<MoneyText paise={po.totalPaise - po.paidPaise} />} />
              )}
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

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {po.poNumber}?</DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete this Purchase Order? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate(po.id, { onSuccess: () => router.push("/procurement") })}
            >
              Delete permanently
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
