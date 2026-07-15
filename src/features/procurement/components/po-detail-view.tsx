"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Lock, Send, Check, GitBranch, Trash2, ShoppingCart } from "lucide-react";
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
import { formatDate, relativeTime } from "@/features/projects/format";
import { usePurchaseOrder, usePOMutations } from "../hooks";

export function PODetailView({ id, isOwner }: { id: string; isOwner: boolean }) {
  const router = useRouter();
  const { data: po, isLoading } = usePurchaseOrder(id);
  const { submit, approve, revise, remove } = usePOMutations();
  const [confirmDelete, setConfirmDelete] = React.useState(false);

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
          {po.status === "DRAFT" && (
            <>
              <Button variant="primary" onClick={() => submit.mutate(po.id)} disabled={submit.isPending}>
                <Send />
                Submit for approval
              </Button>
              {isOwner && (
                <Button variant="ghost" size="icon" className="text-danger-foreground" onClick={() => setConfirmDelete(true)} aria-label="Delete">
                  <Trash2 className="size-4" />
                </Button>
              )}
            </>
          )}
          {po.status === "SUBMITTED" && isOwner && (
            <Button variant="primary" onClick={() => approve.mutate(po.id)} disabled={approve.isPending}>
              <Check />
              Approve
            </Button>
          )}
          {approved && (
            <Button
              variant="secondary"
              onClick={() => revise.mutate(po.id, { onSuccess: (p) => router.push(`/procurement/${p.id}`) })}
              disabled={revise.isPending}
            >
              <GitBranch />
              Revise
            </Button>
          )}
        </div>
      </div>

      {approved && (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-subtle/40 px-3 py-2 text-sm text-success-foreground">
          <Lock className="size-4" />
          Approved {po.approvedByName ? `by ${po.approvedByName}` : ""}
          {po.approvedAt ? ` · ${relativeTime(po.approvedAt)}` : ""} — this PO is locked. Use Revise to change it.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Line items</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-[1fr_70px_90px_100px] gap-2 border-b border-border px-5 py-2 text-xs text-foreground-subtle">
              <span>Material</span><span>Qty</span><span>Rate</span><span className="text-right">Amount</span>
            </div>
            {po.lineItems.map((l) => (
              <div key={l.id} className="grid grid-cols-[1fr_70px_90px_100px] gap-2 border-b border-border px-5 py-3 text-sm last:border-0">
                <span className="truncate font-medium">{l.material}</span>
                <span className="text-foreground-muted">{l.quantity} {l.unit}</span>
                <span className="font-mono text-foreground-muted"><MoneyText paise={l.ratePaise} whole /></span>
                <span className="text-right font-mono"><MoneyText paise={l.amountPaise} whole /></span>
              </div>
            ))}
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-sm font-medium">Total</span>
              <span className="text-lg font-semibold"><MoneyText paise={po.totalPaise} /></span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="divide-y divide-border py-0 text-sm">
            <Row label="Vendor" value={<Link href={`/vendors/${po.vendor.id}`} className="text-primary hover:underline">{po.vendor.name}</Link>} />
            <Row label="Project" value={<Link href={`/projects/${po.project.id}`} className="text-primary hover:underline">{po.project.name}</Link>} />
            <Row label="Date" value={formatDate(po.purchaseDate)} />
            <Row label="Invoice #" value={po.invoiceNumber ?? "—"} />
            <Row label="Created by" value={po.createdByName} />
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {po.poNumber}?</DialogTitle>
            <DialogDescription>This draft purchase order will be permanently removed.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => remove.mutate(po.id, { onSuccess: () => router.push("/procurement") })}>Delete</Button>
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
