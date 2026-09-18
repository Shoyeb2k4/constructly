"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
}

/**
 * A searchable list of checkboxes — the multi-select used inside sheets.
 *
 * Deliberately NOT a popover combobox. Inside a sheet a floating layer has to
 * be positioned, clipped and scroll-locked against a panel that is itself
 * scrolling, and on a phone that is where multi-selects usually break. An
 * inline list has none of those problems: it lays out in the flow, wraps at any
 * width, and native checkboxes give keyboard and screen-reader support
 * (Tab to move, Space to toggle, "checked" announced) without custom focus code
 * to get wrong. Same convention as the checkbox lists in the agreement sheets.
 *
 * Filtering is the CALLER's job: pass the already-matching `options`, so the
 * caller can also decide what to offer when nothing matches (`footer`).
 */
export function MultiSelectList({
  label,
  options,
  selected,
  onToggle,
  query,
  onQueryChange,
  searchPlaceholder = "Search…",
  footer,
  className,
}: {
  /** Accessible name for the list, e.g. "Materials". */
  label: string;
  options: MultiSelectOption[];
  selected: ReadonlySet<string>;
  onToggle: (value: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
  searchPlaceholder?: string;
  /** Rendered under the options — empty states, a create action. */
  footer?: React.ReactNode;
  className?: string;
}) {
  const listId = React.useId();
  return (
    <div className={cn("overflow-hidden rounded-[var(--radius)] border border-border-strong bg-surface", className)}>
      <div className="relative border-b border-border">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          // Enter must not submit the surrounding form mid-search, and must
          // never be a shortcut for creating whatever was typed.
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          placeholder={searchPlaceholder}
          aria-label={`Search ${label.toLowerCase()}`}
          aria-controls={listId}
          className="h-10 w-full min-w-0 bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-foreground-subtle"
        />
      </div>
      {options.length > 0 && (
        <fieldset id={listId}>
          <legend className="sr-only">{label}</legend>
          <ul className="max-h-56 overflow-y-auto p-1">
            {options.map((o) => {
              const checked = selected.has(o.value);
              return (
                <li key={o.value}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-surface-muted",
                      checked && "font-medium",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(o.value)}
                      className="size-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}
      {footer && <div className="border-t border-border px-3 py-2.5">{footer}</div>}
    </div>
  );
}
