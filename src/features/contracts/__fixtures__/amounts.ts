/**
 * Canonical rupee→paise constants for agreement seeds and tests.
 *
 * WHY THIS FILE EXISTS: an earlier draft wrote ₹60,00,000 as `600_000_00` —
 * 60,000,000 paise, which is ₹6,00,000, exactly one tenth. The whole
 * authoritative acceptance scenario would have run at 1/10th value and every
 * assertion would still have passed, because the expectations were written from
 * the same wrong literal.
 *
 * The fix is structural, not a corrected literal: nothing outside this module
 * hand-writes a paise amount. Everything derives from `toPaise`, the same helper
 * the application uses, and amounts.test.ts pins each constant against its
 * expected integer AND its formatted Indian-notation rendering.
 *
 *   ₹1 lakh = ₹1,00,000 = 100_000 rupees = 10_000_000 paise
 */

import { toPaise } from "@/lib/money";
import type { Paise } from "@/lib/money";

/** Rupees → paise. Use for any amount that isn't a round lakh. */
export const rupees = (amount: number): Paise => toPaise(amount);

/** Lakhs → paise. `lakhs(60)` is ₹60,00,000. */
export const lakhs = (count: number): Paise => toPaise(count * 100_000);

/** Crores → paise. `crores(2.5)` is ₹2,50,00,000. */
export const crores = (count: number): Paise => toPaise(count * 10_000_000);

// The authoritative acceptance scenario (Pappu Contractor → Project A →
// Structure). Named so a mis-scaled value is obvious at the call site.
export const RS_2L = lakhs(2); //     20_000_000 — ₹2,00,000
export const RS_3L = lakhs(3); //     30_000_000 — ₹3,00,000
export const RS_4L = lakhs(4); //     40_000_000 — ₹4,00,000
export const RS_5L = lakhs(5); //     50_000_000 — ₹5,00,000
export const RS_6L = lakhs(6); //     60_000_000 — ₹6,00,000
export const RS_8L = lakhs(8); //     80_000_000 — ₹8,00,000
export const RS_10L = lakhs(10); //  100_000_000 — ₹10,00,000
export const RS_12L = lakhs(12); //  120_000_000 — ₹12,00,000
export const RS_15L = lakhs(15); //  150_000_000 — ₹15,00,000
export const RS_20L = lakhs(20); //  200_000_000 — ₹20,00,000
export const RS_40L = lakhs(40); //  400_000_000 — ₹40,00,000
export const RS_50L = lakhs(50); //  500_000_000 — ₹50,00,000
export const RS_52L = lakhs(52); //  520_000_000 — ₹52,00,000
export const RS_60L = lakhs(60); //  600_000_000 — ₹60,00,000
