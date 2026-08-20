"use client";

/**
 * A labelled form control.
 *
 * Every `label` violation in the app traced to the same shape: a `<Label>` and
 * an `<Input>` sitting as siblings in a wrapper `div`, visually paired but never
 * associated. Eleven of them came from ONE local helper. Nothing about that is
 * careless — remembering to mint an id, pass it to `htmlFor` and pass it again
 * to the control is exactly the sort of bookkeeping a component should do.
 *
 * So `Field` owns the id. It generates one, wires `htmlFor`/`id`, and links any
 * hint or error through `aria-describedby`, which is also how a screen reader
 * learns a field is invalid and why.
 *
 * Placeholders are deliberately NOT accepted as a label: they vanish on input,
 * are not announced consistently, and were the reason these fields looked
 * labelled while failing.
 */

import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: React.ReactNode;
  /** Persistent help, rendered under the control and announced with it. */
  hint?: React.ReactNode;
  /** Validation message. Its presence also marks the control invalid. */
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
  /** A single form control. It receives `id` and `aria-describedby`. */
  children: React.ReactElement;
}) {
  const id = React.useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  const control = React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
    id,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : undefined,
  });

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </Label>
      {control}
      {hint && (
        <p id={hintId} className="text-xs text-foreground-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
