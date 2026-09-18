"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useCan } from "@/features/rbac/permission-context";
import { procurementKeys } from "../data";
import {
  ChevronRight,
  Star,
  Phone,
  Mail,
  MapPin,
  FileText,
  Truck,
  IndianRupee,
  X,
  Lock,
  Trash2,
  ExternalLink,
  Upload,
  Pencil,
  File as FileIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/patterns/empty-state";
import { MoneyText } from "@/components/patterns/money-text";
import { StatusBadge, PO_STATUS_META } from "@/components/patterns/status-badge";
import { AddVendorSheet } from "./add-vendor-sheet";
import { MaterialRefChip, UnlinkedMaterialNames } from "./material-ref-chip";
import { cn } from "@/lib/utils";
import { formatDate } from "@/features/projects/format";
import { useVendor, useVendorAging, useVendorMutations } from "../hooks";
import { GovernedDeleteDialog } from "@/features/governance/components/governed-delete-dialog";
import { CopyableRef, PaymentModeChip, PaymentStatusBadge } from "./payment-bits";
import { RecordPaymentDialog } from "./record-payment-dialog";

function Row({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="flex shrink-0 items-center gap-2 text-sm text-foreground-muted"><Icon className="size-4 text-foreground-subtle" />{label}</span>
      <span className="truncate text-sm font-medium">{value || "—"}</span>
    </div>
  );
}

function StatTile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-foreground-subtle">{label}</p>
      <p className="mt-1 text-lg font-semibold">{children}</p>
    </div>
  );
}

export function VendorDetailView({ id }: { id: string }) {
  const can = useCan();
  const { data: vendor, isLoading } = useVendor(id);
  const { toggleFavorite, addDocument, removeDocument } = useVendorMutations();
  const qc = useQueryClient();
  const [payOpen, setPayOpen] = React.useState(false);
  const [tab, setTab] = React.useState("overview");
  /** Project filter pill — set from the Projects tab, applies profile-wide. */
  const [projectFilter, setProjectFilter] = React.useState<string | null>(null);
  const [confirmPaymentId, setConfirmPaymentId] = React.useState<string | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);
  const { data: aging } = useVendorAging(id, projectFilter ?? undefined);
  const fileRef = React.useRef<HTMLInputElement>(null);

  if (isLoading) {
    return <div className="space-y-6"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 rounded-xl" /></div>;
  }
  if (!vendor) {
    return (
      <EmptyState icon={Truck} title="Vendor not found" description="It may have been removed."
        action={<Button asChild variant="secondary" size="sm"><Link href="/vendors">Back to vendors</Link></Button>} />
    );
  }

  const filteredHistory = projectFilter
    ? vendor.purchaseHistory.filter((p) => p.project.id === projectFilter)
    : vendor.purchaseHistory;
  const filteredPayments = projectFilter
    ? vendor.payments.filter((p) => p.project.id === projectFilter)
    : vendor.payments;
  const filterName = projectFilter
    ? vendor.projects.find((p) => p.project.id === projectFilter)?.project.name ?? "Project"
    : null;
  const scopedOutstanding = projectFilter
    ? vendor.projects.find((p) => p.project.id === projectFilter)?.outstandingPaise ?? 0
    : vendor.outstandingPaise;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <nav className="flex items-center gap-1 text-sm text-foreground-subtle">
            <Link href="/vendors" className="hover:text-foreground">Vendors</Link>
            <ChevronRight className="size-3.5" />
          </nav>
          <div className="mt-1 flex items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">{vendor.businessName}</h1>
            <button onClick={() => toggleFavorite.mutate(vendor.id)} aria-label="Favorite" className="text-foreground-subtle hover:text-warning">
              <Star className={cn("size-5", vendor.isFavorite && "fill-warning text-warning")} />
            </button>
            {vendor.status === "INACTIVE" && <Badge variant="neutral">Inactive</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can("vendors.edit") && (
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
              <Pencil />
              Edit vendor
            </Button>
          )}
          {can("payments.create") && (
            <Button variant="primary" onClick={() => setPayOpen(true)}>
              <IndianRupee />
              Record payment
            </Button>
          )}
        </div>
      </div>
      {editOpen && (
        <AddVendorSheet
          key={vendor.id}
          open
          vendor={vendor}
          onOpenChange={(o) => !o && setEditOpen(false)}
        />
      )}

      {filterName && (
        <button
          onClick={() => setProjectFilter(null)}
          className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10"
        >
          Filtered to {filterName}
          <X className="size-3" />
        </button>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Total purchase"><MoneyText paise={vendor.totalPurchasedPaise} /></StatTile>
        <StatTile label={filterName ? `Outstanding · ${filterName}` : "Outstanding"}>
          <span className={cn(scopedOutstanding > 0 && "text-warning-foreground")}>
            <MoneyText paise={Math.max(0, scopedOutstanding)} />
            {scopedOutstanding < 0 && <span className="ml-1 text-xs font-normal text-success-foreground">(advance <MoneyText paise={-scopedOutstanding} />)</span>}
          </span>
        </StatTile>
        <StatTile label="Projects served">{vendor.projectsServed}</StatTile>
        <StatTile label="Purchase orders">{vendor.poCount}</StatTile>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="orders">Purchase Orders</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="outstanding">Outstanding</TabsTrigger>
        </TabsList>

        {/* ── Overview ─────────────────────────────────────────────────── */}
        <TabsContent value="overview">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-6">
              <Card>
                <CardHeader><CardTitle>General information</CardTitle></CardHeader>
                <CardContent className="divide-y divide-border py-0">
                  <Row icon={FileText} label="GSTIN" value={vendor.gstin ? <span className="font-mono">{vendor.gstin}</span> : null} />
                  <Row icon={FileText} label="PAN" value={vendor.pan ? <span className="font-mono">{vendor.pan}</span> : null} />
                  <Row icon={Phone} label="Contact person" value={vendor.contactPerson} />
                  <Row icon={Phone} label="Phone" value={vendor.phone} />
                  <Row icon={Mail} label="Email" value={vendor.email} />
                  <Row icon={MapPin} label="Address" value={vendor.address} />
                  <Row icon={FileText} label="Payment terms" value={vendor.paymentTerms} />
                </CardContent>
              </Card>
              {/* From the vendor's Material Master mappings. Shown even when
                  empty, and archived materials are listed (marked) rather than
                  hidden — the card states what the vendor is mapped to. */}
              <Card>
                <CardHeader><CardTitle>Materials supplied</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {vendor.materials.length === 0 && vendor.unlinkedMaterialNames.length === 0 ? (
                    <p className="text-sm text-foreground-subtle">No materials recorded for this vendor.</p>
                  ) : vendor.materials.length === 0 ? null : (
                    <ul className="flex flex-wrap gap-1.5" aria-label="Materials supplied">
                      {vendor.materials.map((m) => (
                        <li key={m.id} className="max-w-full">
                          <MaterialRefChip material={m} />
                        </li>
                      ))}
                    </ul>
                  )}
                  <UnlinkedMaterialNames names={vendor.unlinkedMaterialNames} />
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader><CardTitle>Recent purchase orders</CardTitle></CardHeader>
              <CardContent className="p-0">
                {vendor.purchaseHistory.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-foreground-subtle">No purchase orders yet.</p>
                ) : (
                  vendor.purchaseHistory.slice(0, 6).map((po) => <PORow key={po.id} po={po} />)
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Projects ─────────────────────────────────────────────────── */}
        <TabsContent value="projects">
          <Card>
            <CardContent className="p-0">
              {vendor.projects.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-foreground-subtle">
                  This vendor hasn&apos;t supplied any project yet.
                </p>
              ) : (
                <>
                  <div className="hidden grid-cols-[1fr_110px_110px_60px_110px_32px] gap-2 border-b border-border px-5 py-2 text-xs text-foreground-subtle sm:grid">
                    <span>Project</span><span className="text-right">Purchase value</span><span className="text-right">Outstanding</span><span className="text-right">POs</span><span className="text-right">Last supply</span><span />
                  </div>
                  {vendor.projects.map((r) => (
                    <div
                      key={r.project.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => { setProjectFilter(r.project.id); setTab("orders"); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { setProjectFilter(r.project.id); setTab("orders"); } }}
                      className="grid cursor-pointer grid-cols-2 items-center gap-2 border-b border-border px-5 py-3 text-sm transition-colors last:border-0 hover:bg-surface-muted/40 sm:grid-cols-[1fr_110px_110px_60px_110px_32px]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{r.project.name}</span>
                        <span className="block font-mono text-xs text-foreground-subtle">{r.project.code}</span>
                      </span>
                      <span className="text-right font-mono"><MoneyText paise={r.purchaseValuePaise} /></span>
                      <span className={cn("text-right font-mono", r.outstandingPaise > 0 && "text-warning-foreground")}>
                        <MoneyText paise={Math.max(0, r.outstandingPaise)} />
                      </span>
                      <span className="text-right text-foreground-muted">{r.poCount}</span>
                      <span className="text-right text-xs text-foreground-muted">{r.lastSupplyDate ? formatDate(r.lastSupplyDate) : "—"}</span>
                      <Link
                        href={`/projects/${r.project.id}?tab=procurement`}
                        onClick={(e) => e.stopPropagation()}
                        className="justify-self-end text-foreground-subtle hover:text-primary"
                        aria-label={`Open ${r.project.name} procurement`}
                      >
                        <ExternalLink className="size-3.5" />
                      </Link>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Purchase orders ──────────────────────────────────────────── */}
        <TabsContent value="orders">
          <Card>
            <CardContent className="p-0">
              {filteredHistory.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-foreground-subtle">No purchase orders{filterName ? ` for ${filterName}` : ""} yet.</p>
              ) : (
                filteredHistory.map((po) => <PORow key={po.id} po={po} showProject />)
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Payments ─────────────────────────────────────────────────── */}
        <TabsContent value="payments">
          <Card>
            <CardContent className="p-0">
              {filteredPayments.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-foreground-subtle">
                  No payments{filterName ? ` for ${filterName}` : ""} recorded yet.
                </p>
              ) : (
                filteredPayments.map((p) => (
                  <div key={p.id} className="flex items-center gap-4 border-b border-border px-5 py-3 last:border-0">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium"><MoneyText paise={p.amountPaise} /></span>
                        <PaymentModeChip mode={p.paymentMode} />
                      </div>
                      <p className="mt-0.5 truncate text-xs text-foreground-subtle">
                        {p.project.name}
                        {p.purchaseOrder ? <> · <Link href={`/procurement/${p.purchaseOrder.id}`} className="font-mono hover:text-primary hover:underline">{p.purchaseOrder.poNumber}</Link></> : " · On account"}
                        {p.remarks ? ` · ${p.remarks}` : ""}
                      </p>
                    </div>
                    <CopyableRef value={p.referenceNumber} />
                    <span className="shrink-0 text-xs text-foreground-subtle">{formatDate(p.date)}</span>
                    {can("payments.delete") && (
                      <button
                        onClick={() => setConfirmPaymentId(p.id)}
                        className="text-foreground-subtle hover:text-foreground"
                        aria-label="Why this payment can't be removed"
                      >
                        <Lock className="size-3.5" />
                      </button>
                    )}
                  </div>
                ))
              )}
              {filteredPayments.length > 0 && (
                <p className="px-5 py-3 text-xs text-foreground-subtle">
                  Recorded payments stay as they happened — they can&apos;t be edited or
                  removed. Record a correcting payment instead.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Documents ────────────────────────────────────────────────── */}
        <TabsContent value="documents">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Documents</CardTitle>
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    e.target.value = "";
                    const { isDemoMode } = await import("@/lib/env");
                    if (isDemoMode) {
                      addDocument.mutate({
                        vendorId: vendor.id,
                        doc: { filename: f.name, sizeBytes: f.size, mimeType: f.type || "application/octet-stream" },
                      });
                      return;
                    }
                    // Production: bytes → Supabase Storage via server action.
                    const { uploadVendorDocument } = await import("@/features/documents/upload-actions");
                    const fd = new FormData();
                    fd.set("file", f);
                    const res = await uploadVendorDocument(vendor.id, fd);
                    if (res.ok) {
                      toast.success(`Uploaded ${f.name}`);
                      qc.invalidateQueries({ queryKey: procurementKeys.vendor(vendor.id) });
                    } else {
                      toast.error(`Couldn't upload ${f.name}`, { description: res.error });
                    }
                  }}
                />
                <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload />
                  Add document
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {vendor.documents.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-foreground-subtle">
                  No documents yet — rate contracts, GST certificates, agreements.
                </p>
              ) : (
                vendor.documents.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 border-b border-border px-5 py-3 last:border-0">
                    <FileIcon className="size-4 shrink-0 text-foreground-subtle" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{d.filename}</p>
                      <p className="text-xs text-foreground-subtle">
                        {d.category} · {(d.sizeBytes / 1024).toFixed(0)} KB · {formatDate(d.createdAt)}
                      </p>
                    </div>
                    <button
                      onClick={() => removeDocument.mutate({ vendorId: vendor.id, docId: d.id })}
                      className="text-foreground-subtle hover:text-danger-foreground"
                      aria-label="Remove document"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Outstanding + aging ──────────────────────────────────────── */}
        <TabsContent value="outstanding">
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-3">
              <StatTile label="0–30 days"><MoneyText paise={aging?.d0_30 ?? 0} /></StatTile>
              <StatTile label="31–60 days">
                <span className={cn((aging?.d31_60 ?? 0) > 0 && "text-warning-foreground")}>
                  <MoneyText paise={aging?.d31_60 ?? 0} />
                </span>
              </StatTile>
              <StatTile label="60+ days">
                <span className={cn((aging?.d60_plus ?? 0) > 0 && "text-danger-foreground")}>
                  <MoneyText paise={aging?.d60_plus ?? 0} />
                </span>
              </StatTile>
            </div>
            {(aging?.onAccountPaise ?? 0) > 0 && (
              <div className="rounded-lg border border-success/30 bg-success-subtle/40 px-3 py-2 text-sm text-success-foreground">
                <MoneyText paise={aging!.onAccountPaise} /> paid on account beyond open POs (advance credit).
              </div>
            )}
            <Card>
              <CardHeader><CardTitle>Open purchase orders</CardTitle></CardHeader>
              <CardContent className="p-0">
                {!aging || aging.rows.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-foreground-subtle">
                    Nothing outstanding{filterName ? ` for ${filterName}` : ""} — all settled. 🎉
                  </p>
                ) : (
                  aging.rows.map((r) => (
                    <Link
                      key={r.poId}
                      href={`/procurement/${r.poId}`}
                      className="flex items-center gap-4 border-b border-border px-5 py-3 text-sm transition-colors last:border-0 hover:bg-surface-muted/40"
                    >
                      <span className="min-w-0 flex-1 font-mono">{r.poNumber ?? r.poId.slice(0, 8)}</span>
                      <span className="text-xs text-foreground-subtle">{formatDate(r.purchaseDate)}</span>
                      <span className={cn(
                        "w-16 text-right text-xs",
                        r.ageDays > 60 ? "text-danger-foreground" : r.ageDays > 30 ? "text-warning-foreground" : "text-foreground-muted",
                      )}>
                        {r.ageDays}d
                      </span>
                      <span className="w-28 text-right font-mono font-medium"><MoneyText paise={r.outstandingPaise} /></span>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <RecordPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        defaultVendorId={vendor.id}
        defaultProjectId={projectFilter ?? undefined}
      />

      {/* A recorded vendor payment is cash that moved. The server refuses to
          remove one, so the UI says so instead of offering a button that fails.
          See features/governance/delete-policy.ts. */}
      <GovernedDeleteDialog
        entity="vendorPayment"
        open={confirmPaymentId != null}
        onOpenChange={(o) => !o && setConfirmPaymentId(null)}
        subject={vendor.businessName}
      />
    </div>
  );
}

function PORow({ po, showProject }: { po: import("../types").PurchaseOrderListItem; showProject?: boolean }) {
  return (
    <Link
      href={`/procurement/${po.id}`}
      className="flex items-center gap-4 border-b border-border px-5 py-3 transition-colors last:border-0 hover:bg-surface-muted/40"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-sm">{po.poNumber}</p>
        <p className="truncate text-xs text-foreground-subtle">
          {showProject ? `${po.project.name} · ` : ""}{formatDate(po.purchaseDate)}
        </p>
      </div>
      <PaymentStatusBadge status={po.paymentStatus} />
      <span className="font-mono text-sm"><MoneyText paise={po.totalPaise} /></span>
      <StatusBadge meta={PO_STATUS_META} value={po.status} />
    </Link>
  );
}
