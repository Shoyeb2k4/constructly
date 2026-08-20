"use client";

/**
 * A compact view of one transaction.
 *
 * Deliberately NOT a second editing surface. The purchase order, the agreement
 * and the settlement each own their own workflow, their own validation and
 * their own reversal rules; rebuilding any of that here would mean two places
 * that can disagree about the same money. So this answers the questions the list
 * cannot fit — what was it for, how was it paid, what reference exists, was it
 * reversed and why — and then hands over to the record that owns it.
 */

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Undo2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/patterns/callout";
import { MoneyText } from "@/components/patterns/money-text";
import { formatDate } from "@/features/projects/format";
import { PAYMENT_MODE_LABEL } from "@/features/procurement/constants";
import {
  STATUS_META,
  TRANSACTION_TYPE_LABEL,
  TRANSACTION_TYPE_MEANING,
} from "../constants";
import type { PaymentTransaction } from "../types";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2.5 last:border-0">
      <dt className="min-w-0 shrink text-[13px] text-foreground-muted">{label}</dt>
      <dd className="min-w-0 text-right text-sm">{children}</dd>
    </div>
  );
}

export function TransactionDetailSheet({
  transaction,
  onOpenChange,
}: {
  transaction: PaymentTransaction | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = transaction;
  return (
    <Sheet open={!!t} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined} className="overflow-y-auto">
        {t && (
          <>
            <SheetHeader>
              <SheetTitle>{TRANSACTION_TYPE_LABEL[t.type]}</SheetTitle>
              <SheetDescription>{TRANSACTION_TYPE_MEANING[t.type]}</SheetDescription>
            </SheetHeader>

            <div className="min-w-0 space-y-5 px-6 py-5">
              <div>
                <p className="text-[13px] text-foreground-muted">Amount paid</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight">
                  <MoneyText paise={t.amountPaise} />
                </p>
              </div>

              {t.status === "REVERSED" && (
                <Callout tone="blocked" title="This payment was reversed" icon={Undo2}>
                  <p>
                    It is kept as history and is excluded from every paid total.
                    {t.reversedAt ? ` Reversed on ${formatDate(t.reversedAt)}.` : ""}
                  </p>
                  {t.reversalReason && <p className="mt-1">Reason: {t.reversalReason}</p>}
                </Callout>
              )}

              <dl className="min-w-0">
                <Row label="Status">
                  <Badge variant={STATUS_META[t.status].tone}>{STATUS_META[t.status].label}</Badge>
                </Row>
                <Row label="Date">{formatDate(t.date)}</Row>
                <Row label={t.party.type === "VENDOR" ? "Vendor" : "Contractor"}>
                  {t.party.href ? (
                    <Link href={t.party.href} className="text-primary hover:underline">
                      {t.party.name}
                    </Link>
                  ) : (
                    t.party.name
                  )}
                </Row>
                <Row label="Project">
                  {t.project ? (
                    <Link
                      href={`/projects/${t.project.id}`}
                      className="text-primary hover:underline"
                    >
                      {t.project.name}
                    </Link>
                  ) : (
                    // A company-wide advance has no project. Saying so is the
                    // honest answer; borrowing a project name would not be.
                    <span className="text-foreground-muted">{t.scopeLabel ?? "—"}</span>
                  )}
                </Row>
                {t.project && t.scopeLabel && <Row label="Against">{t.scopeLabel}</Row>}
                <Row label="Payment mode">
                  {t.paymentMode ? (
                    PAYMENT_MODE_LABEL[t.paymentMode]
                  ) : (
                    // The contractor ledger records no mode. An empty cell is a
                    // fact about the record, not a gap to fill with a guess.
                    <span className="text-foreground-subtle">Not recorded</span>
                  )}
                </Row>
                <Row label="Reference">
                  {t.reference ?? <span className="text-foreground-subtle">None</span>}
                </Row>
                {t.description && <Row label="Note">{t.description}</Row>}
              </dl>

              {t.context.length > 0 && (
                <div className="rounded-lg border border-border bg-surface-muted/40 p-3">
                  <p className="text-[13px] font-medium">What made up this settlement</p>
                  <p className="mt-0.5 text-xs text-foreground-subtle">
                    Context only. Neither figure is a second payment, and neither is
                    counted in any total on this page.
                  </p>
                  <dl className="mt-2 min-w-0">
                    {t.context.map((line) => (
                      <div
                        key={line.label}
                        className="flex items-start justify-between gap-4 py-1.5"
                      >
                        <dt className="min-w-0 text-[13px] text-foreground-muted">
                          {line.label}
                          {line.note && (
                            <span className="block text-xs text-foreground-subtle">
                              {line.note}
                            </span>
                          )}
                        </dt>
                        <dd className="shrink-0 text-sm">
                          <MoneyText paise={line.amountPaise} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              <div className="space-y-2">
                <Button asChild className="w-full">
                  <Link href={t.source.href}>
                    Open {t.source.label}
                    <ArrowUpRight className="size-4" />
                  </Link>
                </Button>
                <p className="text-xs text-foreground-subtle">
                  {t.type === "VENDOR_PAYMENT"
                    ? // Stated, not hidden: vendor payments have no reversal in
                      // the domain, and offering one here for symmetry would
                      // promise something the system cannot do.
                      "Vendor payments cannot be reversed in Constructly. Corrections are made where the payment was recorded."
                    : "Corrections are made on the source record, which owns the reversal rules for this instrument."}
                </p>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
