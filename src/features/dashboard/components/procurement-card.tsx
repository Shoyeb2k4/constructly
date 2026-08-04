import Link from "next/link";
import { ShoppingCart, ArrowUpRight, Truck, Package } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MoneyText } from "@/components/patterns/money-text";
import { PaymentStatusBadge } from "@/features/procurement/components/payment-bits";
import type { ProcurementWidget } from "../types";

const MONTH_LABEL = (m: string) =>
  new Date(m + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });

function Metric({ label, children, tone }: { label: string; children: React.ReactNode; tone?: "warning" }) {
  return (
    <div>
      <p className="text-xs text-foreground-subtle">{label}</p>
      <p className={`text-xl font-semibold leading-none ${tone === "warning" ? "text-warning-foreground" : ""}`}>{children}</p>
    </div>
  );
}

function ListSection({ title, icon: Icon, children }: { title: string; icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-foreground-subtle">
        {Icon && <Icon className="size-3" />} {title}
      </p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

export function ProcurementCard({ procurement }: { procurement: ProcurementWidget }) {
  const maxMonth = Math.max(1, ...procurement.monthlyTrend.map((m) => m.procurementPaise));
  const empty = procurement.recentPOs.length === 0;

  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between">
        <CardTitle>Procurement</CardTitle>
        <Link href="/procurement" className="flex items-center gap-0.5 text-xs font-medium text-primary hover:underline">
          All orders <ArrowUpRight className="size-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-5">
        {empty ? (
          <div className="flex flex-col items-center py-8 text-center">
            <ShoppingCart className="size-6 text-foreground-subtle" />
            <p className="mt-1.5 text-sm text-foreground-muted">No purchase orders yet.</p>
          </div>
        ) : (
          <>
            {/* Headline metrics + monthly trend */}
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <div className="grid grid-cols-2 gap-x-4 gap-y-5 self-center sm:grid-cols-4 lg:grid-cols-2">
                <Metric label="Spend"><MoneyText paise={procurement.spendPaise} /></Metric>
                <Metric label="GST paid"><MoneyText paise={procurement.gstPaidPaise} /></Metric>
                <Metric
                  label={`Outstanding${procurement.pendingPaymentsCount > 0 ? ` · ${procurement.pendingPaymentsCount}` : ""}`}
                  tone="warning"
                >
                  <MoneyText paise={procurement.outstandingPaise} />
                </Metric>
                <Metric label="Recent POs">{procurement.recentPOs.length}</Metric>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-foreground-subtle">Monthly spend</p>
                <div className="flex h-16 items-end gap-1.5">
                  {procurement.monthlyTrend.map((m) => (
                    <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${MONTH_LABEL(m.month)}`}>
                      <div
                        className="w-full rounded-t bg-primary/70"
                        style={{ height: `${Math.max(2, Math.round((m.procurementPaise / maxMonth) * 100))}%` }}
                      />
                      <span className="text-[10px] text-foreground-subtle">{MONTH_LABEL(m.month)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Command-center list grid */}
            <div className="grid gap-x-6 gap-y-5 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-3">
              {procurement.outstandingVendors.length > 0 && (
                <ListSection title="Outstanding vendors">
                  {procurement.outstandingVendors.map((v) => (
                    <Link key={v.vendorId} href={`/vendors/${v.vendorId}`} className="flex items-center justify-between text-sm hover:text-primary">
                      <span className="truncate">{v.name}</span>
                      <span className="font-mono text-xs text-warning-foreground"><MoneyText paise={v.amountPaise} compact /></span>
                    </Link>
                  ))}
                </ListSection>
              )}

              {procurement.topVendors.length > 0 && (
                <ListSection title="Top vendors">
                  {procurement.topVendors.map((v) => (
                    <Link key={v.vendorId} href={`/vendors/${v.vendorId}`} className="flex items-center justify-between text-sm hover:text-primary">
                      <span className="truncate">{v.name}</span>
                      <span className="font-mono text-xs text-foreground-muted"><MoneyText paise={v.amountPaise} compact /></span>
                    </Link>
                  ))}
                </ListSection>
              )}

              {procurement.spendByProject.length > 0 && (
                <ListSection title="Spend by project">
                  {procurement.spendByProject.slice(0, 5).map((p) => (
                    <Link key={p.projectId} href={`/projects/${p.projectId}?tab=procurement`} className="flex items-center justify-between text-sm hover:text-primary">
                      <span className="truncate">{p.name}</span>
                      <span className="font-mono text-xs text-foreground-muted"><MoneyText paise={p.amountPaise} compact /></span>
                    </Link>
                  ))}
                </ListSection>
              )}

              {procurement.topMaterials.length > 0 && (
                <ListSection title="Top materials" icon={Package}>
                  {procurement.topMaterials.slice(0, 5).map((m) => (
                    <div key={m.material} className="flex items-center justify-between text-sm">
                      <span className="truncate">{m.material}</span>
                      <span className="font-mono text-xs text-foreground-muted"><MoneyText paise={m.amountPaise} compact /></span>
                    </div>
                  ))}
                </ListSection>
              )}

              {procurement.upcomingDeliveries.length > 0 && (
                <ListSection title="Upcoming deliveries" icon={Truck}>
                  {procurement.upcomingDeliveries.map((d) => (
                    <Link key={d.poId} href={`/procurement/${d.poId}`} className="flex items-center justify-between gap-2 text-sm hover:text-primary">
                      <span className="min-w-0 truncate">
                        <span className="font-mono">{d.poNumber}</span>
                        <span className="ml-1 text-xs text-foreground-subtle">{d.vendorName}</span>
                      </span>
                      <span className="shrink-0 text-xs text-foreground-subtle">{d.daysUntil === 0 ? "today" : `${d.daysUntil}d`}</span>
                    </Link>
                  ))}
                </ListSection>
              )}

              <ListSection title="Recent purchase orders">
                {procurement.recentPOs.slice(0, 5).map((po) => (
                  <Link key={po.id} href={`/procurement/${po.id}`} className="flex items-center gap-2 text-sm hover:text-primary">
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-mono">{po.poNumber}</span>
                      <span className="ml-1.5 text-xs text-foreground-subtle">{po.vendor.name}</span>
                    </span>
                    <PaymentStatusBadge status={po.paymentStatus} />
                    <span className="font-mono text-xs"><MoneyText paise={po.totalPaise} compact /></span>
                  </Link>
                ))}
              </ListSection>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
