"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

/** Heading for a `SelectGroup`. Radix links it to the group for assistive tech. */
export function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn("px-2 py-1.5 text-xs font-medium text-foreground-subtle", className)}
      {...props}
    />
  );
}

/**
 * Recover the placeholder from a `<SelectValue placeholder="…">` child.
 *
 * A compact filter trigger renders only its placeholder or its current value,
 * so when nothing is selected it has NO text node at all and axe reports
 * `button-name` — 10 such violations existed across five screens. Naming each
 * trigger by hand is a rule nobody remembers on the eleventh one, so the
 * fallback lives here: an explicit `aria-label` always wins, and a trigger that
 * has neither still cannot ship nameless.
 */
function placeholderOf(children: React.ReactNode): string | undefined {
  let found: string | undefined;
  React.Children.forEach(children, (child) => {
    if (found || !React.isValidElement(child)) return;
    const placeholder = (child.props as { placeholder?: unknown }).placeholder;
    if (typeof placeholder === "string" && placeholder.trim()) found = placeholder;
  });
  return found;
}

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  const labelled = props["aria-label"] ?? props["aria-labelledby"];
  const fallbackLabel = labelled ? undefined : placeholderOf(children);
  return (
    <SelectPrimitive.Trigger
      aria-label={props["aria-label"] ?? fallbackLabel}
      className={cn(
        "flex h-9 items-center justify-between gap-2 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm outline-none transition-colors",
        "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40",
        "data-[placeholder]:text-foreground-subtle disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 text-foreground-subtle" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        className={cn(
          "relative z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-lg border border-border bg-surface shadow-lg",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          position === "popper" && "translate-y-1",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-md py-1.5 pl-8 pr-2 text-sm outline-none",
        "focus:bg-surface-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4 text-primary" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
