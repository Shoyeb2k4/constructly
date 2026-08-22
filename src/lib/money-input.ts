import type { Paise } from "./money";

/**
 * Indian-grouped money entry — the pure half.
 *
 * Everything here is string ↔ integer-paise conversion, deliberately kept away
 * from React so the arithmetic can be tested exhaustively and so nothing in the
 * domain is ever tempted to do money maths on a formatted string.
 *
 * The two rules that matter:
 *
 *   PRESENTATION ONLY. Commas and ₹ never leave this file. Callers get integer
 *   paise, which is what every schema, repository and report already speaks.
 *
 *   NO FLOAT ARITHMETIC. Rupees and paise are split as STRINGS and combined as
 *   integers. `Math.round(12345678.5 * 100)` is a coin flip on the last paisa;
 *   parsing "12345678" and "50" separately is not.
 */

/** Indian grouping: last three digits, then pairs. 12345678 → 1,23,45,678. */
export function groupIndian(digits: string): string {
  const clean = digits.replace(/\D/g, "");
  if (clean.length <= 3) return clean;
  const last3 = clean.slice(-3);
  const rest = clean.slice(0, -3);
  // Pairs, right to left.
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
}

export interface MoneyFormatOptions {
  /** Decimal places allowed. 0 = whole rupees only. Default 2. */
  decimals?: 0 | 2;
  /** Permit a leading minus. Off unless the field's domain says otherwise. */
  allowNegative?: boolean;
}

/**
 * Format what the user has typed, preserving their in-progress state.
 *
 * A trailing "." and trailing zeros are KEPT: someone typing "1000.50" passes
 * through "1000.5" and "1000.50", and a formatter that normalises those away
 * fights the person typing.
 */
export function formatMoneyInput(raw: string, opts: MoneyFormatOptions = {}): string {
  const { decimals = 2, allowNegative = false } = opts;
  if (raw === "") return "";

  const negative = allowNegative && raw.trimStart().startsWith("-");
  // Strip everything that is not a digit or a decimal point.
  let body = raw.replace(/[^\d.]/g, "");
  if (decimals === 0) body = body.replace(/\./g, "");

  const firstDot = body.indexOf(".");
  let whole = firstDot === -1 ? body : body.slice(0, firstDot);
  // Only the FIRST dot counts; later ones are dropped rather than rejected, so
  // a fumbled keystroke does not wipe the field.
  let fraction = firstDot === -1 ? null : body.slice(firstDot + 1).replace(/\./g, "");

  // Leading zeros collapse, but a lone "0" and "0.xx" survive.
  whole = whole.replace(/^0+(?=\d)/, "");
  if (fraction !== null) fraction = fraction.slice(0, decimals);

  const grouped = groupIndian(whole);
  const sign = negative ? "-" : "";
  if (fraction === null) return `${sign}${grouped}`;
  // `whole` may be empty here (".5"), which is a legitimate half-typed state.
  return `${sign}${grouped}.${fraction}`;
}

/**
 * Parse a display string to integer paise. Returns null for empty or
 * unparseable input — never 0, because "nothing entered" and "zero" are
 * different answers and a required field must be able to tell them apart.
 */
export function parseMoneyInput(raw: string, opts: MoneyFormatOptions = {}): Paise | null {
  const { decimals = 2, allowNegative = false } = opts;
  if (raw == null) return null;

  const trimmed = String(raw).trim();
  if (trimmed === "") return null;

  const negative = trimmed.startsWith("-");
  // Accept anything a person might paste: 125000, 1,25,000, ₹1,25,000.50,
  // "Rs. 1,25,000", non-breaking spaces from a spreadsheet.
  const body = trimmed.replace(/^-/, "").replace(/^(₹|rs\.?|inr)\s*/i, "");

  // Reject genuine garbage rather than salvaging a plausible-looking number
  // out of it: "12abc34" must not silently become ₹1,234.
  if (!/^[\d,\s ]*(\.\d*)?$/.test(body)) return null;

  const cleaned = body.replace(/[,\s ]/g, "");
  if (cleaned === "" || cleaned === ".") return null;

  const [wholeRaw = "", fractionRaw = ""] = cleaned.split(".");
  if (decimals === 0 && fractionRaw !== "") {
    // A whole-rupee field must not quietly swallow paise.
    if (Number(fractionRaw) !== 0) return null;
  }

  const whole = wholeRaw === "" ? 0 : Number(wholeRaw);
  if (!Number.isFinite(whole)) return null;

  // Pad/truncate to exactly two digits, as STRING, then add as integers.
  const paisePart =
    decimals === 0 ? 0 : Number((fractionRaw + "00").slice(0, 2).padEnd(2, "0") || "0");
  if (!Number.isFinite(paisePart)) return null;

  const magnitude = whole * 100 + paisePart;
  if (!Number.isSafeInteger(magnitude)) return null;
  if (negative && !allowNegative) return null;
  return negative ? -magnitude : magnitude;
}

/**
 * Render stored paise as an editable display string — the inverse of
 * `parseMoneyInput`, and what a form seeds its field with.
 */
export function paiseToInput(paise: Paise | null | undefined, opts: MoneyFormatOptions = {}): string {
  const { decimals = 2 } = opts;
  if (paise == null) return "";
  const negative = paise < 0;
  const abs = Math.abs(Math.trunc(paise));
  const whole = Math.floor(abs / 100);
  const rest = abs % 100;
  const grouped = groupIndian(String(whole));
  const sign = negative ? "-" : "";
  // A round amount shows no decimals; ₹1,000.00 is noise on a form.
  if (decimals === 0 || rest === 0) return `${sign}${grouped}`;
  return `${sign}${grouped}.${String(rest).padStart(2, "0")}`;
}

/**
 * Where the caret should sit after reformatting.
 *
 * Counting DIGITS rather than characters is what stops the caret jumping to the
 * end when a comma appears or disappears to the left of it — the single thing
 * that makes a live-formatting field unusable.
 */
export function caretAfterFormat(
  formatted: string,
  previousCaret: number,
  previousValue: string,
): number {
  const digitsBefore = previousValue.slice(0, previousCaret).replace(/[^\d.]/g, "").length;
  if (digitsBefore === 0) {
    // Caret was before any digit; keep it before the first one.
    const firstDigit = formatted.search(/\d/);
    return firstDigit === -1 ? formatted.length : firstDigit;
  }
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/[\d.]/.test(formatted[i])) seen++;
    if (seen === digitsBefore) return i + 1;
  }
  return formatted.length;
}
