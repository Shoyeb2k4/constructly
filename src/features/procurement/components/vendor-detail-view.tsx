"use client";

import Link from "next/link";
import { ChevronRight, Star, Phone, Mail, MapPin, FileText, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/patterns/empty-state";
import { MoneyText } from "@/components/patterns/money-text";
import { StatusBadge, PO_STATUS_META } from "@/components/patterns/status-badge";
import { TagChip } from "@/features/projects/components/tag-chip";
import { cn } from "@/lib/utils";
import { formatDate } from "@/features/projects/format";
import { useVendor, useVendorMutations } from "../hooks";

function Row({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="flex items-center gap-2 text-sm text-foreground-muted"><Icon className="size-4 text-foreground-subtle" />{label}</span>
      <span className="truncate text-sm font-medium">{value || "—"}</span>
    </div>
  );
}

export function VendorDetailView({ id }: { id: string }) {
  const { data: vendor, isLoading } = useVendor(id);
  const { toggleFavorite } = useVendorMutations();

  if (isLoading) {
    return <div className="space-y-6"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 rounded-xl" /></div>;
  }
  if (!vendor) {
    return (
      <EmptyState icon={Truck} title="Vendor not found" description="It may have been removed."
        action={<Button asChild variant="secondary" size="sm"><Link href="/vendors">Back to vendors</Link></Button>} />
    );
  }

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
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs text-foreground-subtle">Lifetime</p>
              <p className="mt-1 text-lg font-semibold"><MoneyText paise={vendor.totalPurchasedPaise} compact /></p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs text-foreground-subtle">Orders</p>
              <p className="mt-1 text-lg font-semibold">{vendor.poCount}</p>
            </div>
          </div>
          <Card>
            <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
            <CardContent className="divide-y divide-border py-0">
              <Row icon={Phone} label="Contact" value={vendor.contactPerson} />
              <Row icon={Phone} label="Phone" value={vendor.phone} />
              <Row icon={Mail} label="Email" value={vendor.email} />
              <Row icon={FileText} label="GSTIN" value={vendor.gstin ? <span className="font-mono">{vendor.gstin}</span> : null} />
              <Row icon={MapPin} label="Address" value={vendor.address} />
              <Row icon={FileText} label="Payment terms" value={vendor.paymentTerms} />
            </CardContent>
          </Card>
          {vendor.materialsSupplied.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Materials</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {vendor.materialsSupplied.map((m) => <TagChip key={m} label={m} />)}
              </CardContent>
            </Card>
          )}
        </div>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Purchase history</CardTitle></CardHeader>
          <CardContent className="p-0">
            {vendor.purchaseHistory.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-foreground-subtle">No purchase orders yet.</p>
            ) : (
              vendor.purchaseHistory.map((po) => (
                <Link
                  key={po.id}
                  href={`/procurement/${po.id}`}
                  className="flex items-center gap-4 border-b border-border px-5 py-3 transition-colors last:border-0 hover:bg-surface-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm">{po.poNumber}</p>
                    <p className="truncate text-xs text-foreground-subtle">{po.project.name} · {formatDate(po.purchaseDate)}</p>
                  </div>
                  <span className="font-mono text-sm"><MoneyText paise={po.totalPaise} compact /></span>
                  <StatusBadge meta={PO_STATUS_META} value={po.status} />
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
