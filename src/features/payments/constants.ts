import { Banknote, HandCoins, Receipt, Truck, type LucideIcon } from "lucide-react";
import type {
  PaymentPartyType,
  PaymentStatus,
  PaymentTransactionType,
  PeriodPreset,
} from "./types";

/**
 * The user-facing instrument vocabulary. Each label names the instrument, not
 * the table it came from, and each is the word the SOURCE module already uses —
 * so a figure means the same thing here as it does where it was recorded.
 */
export const TRANSACTION_TYPE_LABEL: Record<PaymentTransactionType, string> = {
  CONTRACTOR_ADVANCE: "Contractor advance",
  CONTRACTOR_PAYMENT: "Contractor payment",
  LABOUR_SETTLEMENT: "Labour settlement",
  VENDOR_PAYMENT: "Vendor payment",
};

/**
 * One line each, explaining what the instrument IS. Shown in the detail view,
 * because "Labour settlement" is only obvious to someone who already knows.
 */
export const TRANSACTION_TYPE_MEANING: Record<PaymentTransactionType, string> = {
  CONTRACTOR_ADVANCE:
    "Cash paid to a contractor ahead of the work. It is drawn down by later settlements.",
  CONTRACTOR_PAYMENT: "Cash paid against a commercial agreement with a contractor.",
  LABOUR_SETTLEMENT:
    "The net cash a weekly settlement paid out, after any advance was applied to the bill.",
  VENDOR_PAYMENT: "Cash paid to a vendor, against a purchase order or on account.",
};

/**
 * Icons classify; they do not warn. Type is not severity, so these carry no
 * colour of their own and every row renders them the same way.
 */
export const TRANSACTION_TYPE_ICON: Record<PaymentTransactionType, LucideIcon> = {
  CONTRACTOR_ADVANCE: HandCoins,
  CONTRACTOR_PAYMENT: Receipt,
  LABOUR_SETTLEMENT: Banknote,
  VENDOR_PAYMENT: Truck,
};

export const TRANSACTION_TYPES: PaymentTransactionType[] = [
  "CONTRACTOR_ADVANCE",
  "CONTRACTOR_PAYMENT",
  "LABOUR_SETTLEMENT",
  "VENDOR_PAYMENT",
];

export const PARTY_TYPE_LABEL: Record<PaymentPartyType, string> = {
  CONTRACTOR: "Contractor",
  VENDOR: "Vendor",
};

/**
 * A recorded payment is ordinary financial history, not an achievement — so
 * ACTIVE is neutral, never a green "Success". Only REVERSED needs to stand out,
 * because the money it describes is no longer counted anywhere.
 */
export const STATUS_META: Record<PaymentStatus, { label: string; tone: "neutral" | "danger" }> = {
  ACTIVE: { label: "Active", tone: "neutral" },
  REVERSED: { label: "Reversed", tone: "danger" },
};

export const PERIOD_PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: "THIS_MONTH", label: "This month" },
  { value: "LAST_MONTH", label: "Last month" },
  { value: "LAST_90", label: "Last 90 days" },
  { value: "FINANCIAL_YEAR", label: "Financial year" },
  { value: "ALL_TIME", label: "All time" },
  { value: "CUSTOM", label: "Custom range" },
];
