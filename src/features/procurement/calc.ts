import type { POLineItemInput } from "./types";

/** Line amount = quantity × rate, in integer paise. */
export function lineAmountPaise(quantity: number, ratePaise: number): number {
  return Math.round(quantity * ratePaise);
}

/** PO total = Σ line amounts. */
export function poTotalPaise(lines: POLineItemInput[]): number {
  return lines.reduce((sum, l) => sum + lineAmountPaise(l.quantity, l.ratePaise), 0);
}
