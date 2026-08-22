"use client";

/**
 * The rupee entry field.
 *
 * Every money form in the app had its own plain number input, so ₹1,23,45,678
 * was typed as an undifferentiated run of eight digits and checked by counting
 * them. This groups the number the Indian way as you type, and hands the caller
 * integer paise — never a formatted string, and never a float.
 *
 * Three things it is careful about:
 *
 *   THE CARET. Reformatting on every keystroke is what makes naive money fields
 *   unusable: insert a digit in the middle, a comma appears to the left, and the
 *   caret snaps to the end. Position is restored by counting DIGITS, so it stays
 *   where the typist left it.
 *
 *   EMPTY IS NOT ZERO. A cleared field reports `null`, so a required field can
 *   still tell "not filled in" from "₹0".
 *
 *   THE ₹ IS DECORATION. It sits outside the text box, marked `aria-hidden`,
 *   with the currency carried in the accessible description instead — a screen
 *   reader should not read "rupee one comma two three".
 */

import { useFieldWiring } from "./field";
import * as React from "react";
import { cn } from "@/lib/utils";
import {
  caretAfterFormat,
  formatMoneyInput,
  paiseToInput,
  parseMoneyInput,
} from "@/lib/money-input";
import { toPaise, toRupees, type Paise } from "@/lib/money";

export interface MoneyInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "value" | "onChange" | "type" | "inputMode"
  > {
  /** Current amount in integer paise. `null` renders an empty field. */
  value: Paise | null;
  /** Fires with integer paise, or `null` when the field is cleared. */
  onValueChange: (paise: Paise | null) => void;
  /** 0 for whole-rupee fields. Never widen a field's semantics to get decimals. */
  decimals?: 0 | 2;
  /** Only where the domain genuinely has a signed amount. */
  allowNegative?: boolean;
  /** Trailing unit rendered outside the value, e.g. "/ day". */
  suffix?: React.ReactNode;
}

export function MoneyInput({
  value,
  onValueChange,
  decimals = 2,
  allowNegative = false,
  suffix,
  className,
  disabled,
  "aria-describedby": describedBy,
  ...rest
}: MoneyInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const hintId = React.useId();

  /**
   * When this input sits inside a `Field` but not as its direct child — the
   * `<Field><Controller render={…}/></Field>` shape react-hook-form encourages —
   * the id and description Field cloned never arrive. Claim them from Field's
   * context instead, so the label associates either way. Anything passed
   * explicitly still wins.
   */
  const wiring = useFieldWiring();
  const inputId = (rest.id as string | undefined) ?? wiring?.id;
  const describedByAll = describedBy ?? wiring?.describedBy;
  const invalid = (rest["aria-invalid"] as boolean | undefined) ?? wiring?.invalid;

  /**
   * The text being typed, held locally so half-finished states survive — "1000."
   * on the way to "1000.50" parses to the same paise as "1000", and echoing the
   * parsed value back would delete the decimal point under the user's fingers.
   */
  const [text, setText] = React.useState(() => paiseToInput(value, { decimals }));

  /**
   * While the field has focus, the person typing owns its contents. Nothing
   * external overwrites them — not a form that coerces what it was handed, not
   * one that ignores it, not a background refetch.
   *
   * Without this, clearing a field that arrived with a value was impossible:
   * emptying a budget sends `undefined` to a schema carrying `.default(0)`,
   * the form's value never changes, and the old number is pushed straight back
   * into the box. Every following keystroke then landed in text the user had
   * already deleted — "1,20,00,000" became "1,23,45,61,20,00,000".
   *
   * On blur the field syncs to whatever the form actually holds, so a value
   * that really was rejected snaps back visibly instead of silently.
   */
  // State rather than a ref: this is read while rendering to decide whether an
  // incoming value may overwrite the box, and a ref read during render is both
  // lint-flagged and genuinely wrong — it would not re-render on the change.
  const [focused, setFocused] = React.useState(false);

  // Adopt an externally-changed value (a form reset, a loaded record), but only
  // when it genuinely differs from what is on screen — otherwise every keystroke
  // would round-trip and fight the typist.
  const [lastValue, setLastValue] = React.useState<Paise | null>(value);
  if (value !== lastValue) {
    setLastValue(value);
    if (!focused && parseMoneyInput(text, { decimals, allowNegative }) !== value) {
      setText(paiseToInput(value, { decimals }));
    }
  }

  const caretRef = React.useRef<number | null>(null);
  React.useLayoutEffect(() => {
    const el = inputRef.current;
    if (el && caretRef.current != null) {
      el.setSelectionRange(caretRef.current, caretRef.current);
      caretRef.current = null;
    }
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const caret = e.target.selectionStart ?? raw.length;
    const formatted = formatMoneyInput(raw, { decimals, allowNegative });
    caretRef.current = caretAfterFormat(formatted, caret, raw);
    setText(formatted);
    const paise = parseMoneyInput(formatted, { decimals, allowNegative });
    setLastValue(paise);
    onValueChange(paise);
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 transition-colors",
        "focus-within:border-primary focus-within:ring-2 focus-within:ring-ring",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <span className="shrink-0 select-none text-sm text-foreground-subtle" aria-hidden="true">
        ₹
      </span>
      <input
        {...rest}
        id={inputId}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          // Show what the form ended up with, which may not be what was typed.
          setText(paiseToInput(value, { decimals }));
          rest.onBlur?.(e);
        }}
        aria-invalid={invalid || undefined}
        ref={inputRef}
        type="text"
        // Digits and a decimal point on a phone keypad, without the spinner and
        // scroll-to-change hazards a number input brings to a money field.
        inputMode={decimals === 0 ? "numeric" : "decimal"}
        autoComplete="off"
        value={text}
        disabled={disabled}
        onChange={handleChange}
        aria-describedby={[describedByAll, hintId].filter(Boolean).join(" ") || undefined}
        className={cn(
          "min-w-0 flex-1 bg-transparent py-2 text-sm tabular-nums outline-none",
          "placeholder:text-foreground-subtle disabled:cursor-not-allowed",
        )}
      />
      {suffix && (
        <span className="shrink-0 select-none text-sm text-foreground-subtle">{suffix}</span>
      )}
      {/* The currency, for anyone not seeing the ₹ glyph. */}
      <span id={hintId} className="sr-only">
        Amount in Indian rupees
      </span>
    </div>
  );
}

/**
 * The same field, for forms whose schema speaks RUPEES.
 *
 * Several forms coerce a rupee number and convert on submit; changing that
 * would mean changing what those schemas mean, which is not what a formatting
 * phase should do. So the conversion is bridged here instead, once, rather than
 * repeated inline at every `Controller`.
 *
 * `undefined` and `NaN` both render as empty — react-hook-form produces the
 * latter for a cleared numeric field, and showing "NaN" to someone entering a
 * budget is worse than showing nothing.
 */
export function RupeeInput({
  value,
  onValueChange,
  ...rest
}: Omit<MoneyInputProps, "value" | "onValueChange"> & {
  value: number | undefined;
  onValueChange: (rupees: number | undefined) => void;
}) {
  return (
    <MoneyInput
      {...rest}
      value={typeof value === "number" && Number.isFinite(value) ? toPaise(value) : null}
      onValueChange={(paise) => onValueChange(paise == null ? undefined : toRupees(paise))}
    />
  );
}
