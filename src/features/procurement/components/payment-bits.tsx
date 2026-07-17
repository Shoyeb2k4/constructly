"use client";

import * as React from "react";
import {
  Banknote,
  Copy,
  Check,
  CreditCard,
  IndianRupee,
  Landmark,
  ScrollText,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PAYMENT_MODE_LABEL } from "../constants";
import type { PaymentMode, POPaymentStatus } from "../types";

const MODE_ICON: Record<PaymentMode, React.ComponentType<{ className?: string }>> = {
  CASH: Banknote,
  UPI: IndianRupee,
  BANK_TRANSFER: Landmark,
  CHEQUE: ScrollText,
  CARD: CreditCard,
  OTHER: Wallet,
};

/** Payment mode with its icon — used in payment lists everywhere. */
export function PaymentModeChip({ mode, className }: { mode: PaymentMode; className?: string }) {
  const Icon = MODE_ICON[mode];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-foreground-muted", className)}>
      <Icon className="size-3.5" />
      {PAYMENT_MODE_LABEL[mode]}
    </span>
  );
}

/** One-click copy for payment reference numbers (UTR / cheque no / UPI ref). */
export function CopyableRef({ value }: { value: string | null }) {
  const [copied, setCopied] = React.useState(false);
  if (!value) return <span className="text-foreground-subtle">—</span>;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success("Reference copied");
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Couldn't copy");
        }
      }}
      className="group inline-flex max-w-full items-center gap-1 rounded font-mono text-xs text-foreground-muted hover:text-foreground"
      title="Copy reference"
    >
      <span className="truncate">{value}</span>
      {copied ? (
        <Check className="size-3 shrink-0 text-success-foreground" />
      ) : (
        <Copy className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}

const PAY_STATUS_STYLE: Record<POPaymentStatus, string> = {
  PAID: "bg-success-subtle text-success-foreground border-success/30",
  PARTIAL: "bg-warning-subtle text-warning-foreground border-warning/30",
  UNPAID: "bg-surface-muted text-foreground-muted border-border",
};

export function PaymentStatusBadge({ status }: { status: POPaymentStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        PAY_STATUS_STYLE[status],
      )}
    >
      {status === "PAID" ? "Paid" : status === "PARTIAL" ? "Partial" : "Unpaid"}
    </span>
  );
}
