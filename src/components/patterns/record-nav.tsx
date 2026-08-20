"use client";

/**
 * Section navigation for a single record.
 *
 * The contractor record has ten areas. As one horizontal tab strip that was
 * three too many at every width: "Reconciliation" truncated mid-word, History
 * and Advance ledger fell off the end entirely, and the only way to reach them
 * was a horizontal scroll with no scrollbar, no fade and no arrows. On a phone
 * that strip stacked underneath a second one, so two invisible scrollers sat on
 * top of each other.
 *
 * Adding arrows to a scrolling strip treats the symptom. Ten peers in a row is
 * the problem, so this gives them a shape:
 *
 *   wide   a vertical rail beside the content, grouped under headings. Every
 *          item is visible at once, and the groups say what kind of question
 *          each area answers.
 *   narrow one grouped select. Ten options in a native-feeling menu is a
 *          familiar, discoverable, keyboard-operable control — and it collapses
 *          to a single row of chrome instead of a scrolling strip.
 *
 * Both drive the same Radix Tabs value, so panels, roving focus and arrow-key
 * navigation come from the primitive rather than being re-implemented.
 */

import * as React from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface RecordNavItem {
  value: string;
  label: string;
}

export interface RecordNavGroup {
  /** Says what kind of question this group answers, e.g. "Money". */
  label: string;
  items: RecordNavItem[];
}

export function RecordNav({
  groups,
  value,
  onValueChange,
  /** Names both controls, e.g. "Contractor sections". */
  label,
  className,
}: {
  groups: RecordNavGroup[];
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  const items = groups.flatMap((g) => g.items);

  return (
    <div className={className}>
      {/* NARROW — one compact control, nothing hidden off-screen. */}
      <div className="lg:hidden">
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger aria-label={label} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {groups.map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* WIDE — the rail. `TabsList` keeps roving focus and arrow keys; the
          group headings are presentational and never focusable, so they do not
          interrupt that. */}
      <TabsList
        vertical
        aria-label={label}
        className="hidden w-56 shrink-0 gap-0 bg-transparent p-0 lg:flex"
      >
        {groups.map((group, i) => (
          <React.Fragment key={group.label}>
            <p
              aria-hidden="true"
              className={cn(
                "px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-foreground-subtle",
                i === 0 ? "pt-0" : "pt-4",
              )}
            >
              {group.label}
            </p>
            {group.items.map((item) => (
              <TabsTrigger
                key={item.value}
                value={item.value}
                className={cn(
                  "w-full justify-start rounded-md px-3 py-1.5 text-left font-normal",
                  "data-[state=active]:bg-primary-subtle data-[state=active]:font-medium",
                  "data-[state=active]:text-primary-emphasis data-[state=active]:shadow-none",
                  "hover:text-foreground",
                )}
              >
                {item.label}
              </TabsTrigger>
            ))}
          </React.Fragment>
        ))}
      </TabsList>

      {/* The select renders only the active label; this keeps every section name
          in the accessible tree at narrow widths too, so a screen-reader user
          can perceive the full set without opening the menu. */}
      <span className="sr-only lg:hidden">
        {label}: {items.map((i) => i.label).join(", ")}
      </span>
    </div>
  );
}
