/**
 * Money — all monetary values are stored and computed as integer paise (₹1 = 100 paise).
 * Never use floating point for money. This module is the single source of truth for
 * conversion, arithmetic, and Indian-locale formatting.
 */

export type Paise = number;

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

const INR_WHOLE = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** Convert rupees (possibly fractional) to integer paise. */
export function toPaise(rupees: number): Paise {
  return Math.round(rupees * 100);
}

/** Convert integer paise to a rupees number (for display/formatting only). */
export function toRupees(paise: Paise): number {
  return paise / 100;
}

/** Format paise as an Indian-locale currency string, e.g. ₹1,20,00,000.00 */
export function formatPaise(paise: Paise, opts?: { whole?: boolean }): string {
  const fmt = opts?.whole ? INR_WHOLE : INR;
  return fmt.format(toRupees(paise));
}

/**
 * Smart full formatting — the product-wide default for displaying money.
 * Indian numbering, tabular-friendly, and precision-preserving:
 *   - never rounds (integer paise → exact rupees),
 *   - shows the decimal part ONLY when real paise exist (₹37,04,725.50),
 *   - hides a bare `.00` so whole amounts read cleanly (₹37,04,725).
 * Prefer this over `formatPaise` anywhere a value is shown to a user.
 */
export function formatPaiseSmart(paise: Paise): string {
  const fmt = paise % 100 === 0 ? INR_WHOLE : INR;
  return fmt.format(toRupees(paise));
}

/**
 * Compact Indian formatting using lakh/crore, e.g. ₹92.4L, ₹1.2Cr.
 * Used in dense dashboard widgets where full numbers would crowd the layout.
 */
export function formatPaiseCompact(paise: Paise): string {
  const rupees = toRupees(paise);
  const abs = Math.abs(rupees);
  const sign = rupees < 0 ? "-" : "";
  if (abs >= 1_00_00_000) return `${sign}₹${trim(abs / 1_00_00_000)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${trim(abs / 1_00_000)}L`;
  if (abs >= 1_000) return `${sign}₹${trim(abs / 1_000)}K`;
  return `${sign}₹${Math.round(abs)}`;
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

/** Sum a list of paise values (integer-safe). */
export function sumPaise(values: Paise[]): Paise {
  return values.reduce((acc, v) => acc + Math.round(v), 0);
}

/**
 * Prisma BigInt → Paise, refusing anything JavaScript cannot represent exactly.
 *
 * Money columns are BigInt in the database but `number` in every DTO, because
 * neither BigInt nor Decimal survives the RSC boundary. A bare `Number(bigint)`
 * past 2^53 silently returns a rounded value — a financial figure that is wrong
 * with no error anywhere. This throws instead, naming the field, so a data-range
 * problem surfaces as a bug report rather than a quietly incorrect balance.
 *
 * ₹90,071 crore is the ceiling, so this should never fire in practice; it exists
 * so that if it ever does, it is loud.
 */
export function paiseFromBigInt(value: bigint, field: string): Paise {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(
      `MONEY_OUT_OF_RANGE: ${field} = ${value} exceeds the safe integer range and ` +
        `cannot be converted without losing precision.`,
    );
  }
  return Number(value);
}

/** As `paiseFromBigInt`, tolerating the null/undefined a Prisma aggregate returns. */
export function paiseFromNullableBigInt(value: bigint | null | undefined, field: string): Paise {
  return value == null ? 0 : paiseFromBigInt(value, field);
}
