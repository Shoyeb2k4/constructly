import Link from "next/link";
import { ShoppingCart, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MoneyText } from "@/components/patterns/money-text";
import { PaymentStatusBadge } from "@/features/procurement/components/payment-bits";
import type { ProcurementWidget } from "../types";

const MONTH_LABEL = (m: string) =>
  new Date(m + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });

export function ProcurementCard({ procurement }: { procurement: ProcurementWidget }) {
  const maxMonth = Math.max(1, ...procurement.monthlyTrend.map((m) => m.procurementPaise));

  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between">
        <CardTitle>Procurement</CardTitle>
        <Link href="/procurement" className="flex items-center gap-0.5 text-xs font-medium text-primary hover:underline">
          All orders <ArrowUpRight className="size-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-foreground-subtle">Spend</p>
            <p className="text-2xl font-semibold leading-none"><MoneyText paise={procurement.spendPaise} compact /></p>
          </div>
          <div className="text-right">
            <p className="text-xs text-foreground-subtle">Outstanding</p>
            <p className="text-lg font-medium leading-none text-warning-foreground">
              <MoneyText paise={procurement.outstandingPaise} compact />
            </p>
          </div>
        </div>

        {/* Monthly procurement trend */}
        <div>
          <div className="flex h-16 items-end gap-1.5">
            {procurement.monthlyTrend.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${MONTH_LABEL(m.month)}: ${m.procurementPaise / 100}`}>
                <div
                  className="w-full rounded-t bg-primary/70"
                  style={{ height: `${Math.max(2, Math.round((m.procurementPaise / maxMonth) * 100))}%` }}
                />
                <span className="text-[10px] text-foreground-subtle">{MONTH_LABEL(m.month)}</span>
              </div>
            ))}
          </div>
        </div>

        {procurement.outstandingVendors.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-foreground-subtle">Outstanding vendors</p>
            <div className="space-y-1.5">
              {procurement.outstandingVendors.map((v) => (
                <Link key={v.vendorId} href={`/vendors/${v.vendorId}`} className="flex items-center justify-between text-sm hover:text-primary">
                  <span className="truncate">{v.name}</span>
                  <span className="font-mono text-xs text-warning-foreground"><MoneyText paise={v.amountPaise} compact /></span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {procurement.topVendors.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-foreground-subtle">Top vendors</p>
            <div className="space-y-1.5">
              {procurement.topVendors.map((v) => (
                <Link key={v.vendorId} href={`/vendors/${v.vendorId}`} className="flex items-center justify-between text-sm hover:text-primary">
                  <span className="truncate">{v.name}</span>
                  <span className="font-mono text-xs text-foreground-muted"><MoneyText paise={v.amountPaise} compact /></span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {procurement.recentPOs.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-foreground-subtle">Recent purchase orders</p>
            <div className="space-y-1.5">
              {procurement.recentPOs.slice(0, 4).map((po) => (
                <Link key={po.id} href={`/procurement/${po.id}`} className="flex items-center gap-2 text-sm hover:text-primary">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-mono">{po.poNumber}</span>
                    <span className="ml-1.5 text-xs text-foreground-subtle">{po.vendor.name}</span>
                  </span>
                  <PaymentStatusBadge status={po.paymentStatus} />
                  <span className="font-mono text-xs"><MoneyText paise={po.totalPaise} compact /></span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {procurement.recentPOs.length === 0 && (
          <div className="flex flex-col items-center py-4 text-center">
            <ShoppingCart className="size-6 text-foreground-subtle" />
            <p className="mt-1.5 text-xs text-foreground-muted">No purchase orders yet.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
