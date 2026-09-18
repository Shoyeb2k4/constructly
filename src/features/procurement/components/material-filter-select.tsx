"use client";

import * as React from "react";
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
import { displayMaterialName } from "../material-backfill";
import { materialFilterIntent } from "../material-identity";
import type { Material } from "../types";

/**
 * The Material filter: users see names, the filter stores IDENTITY.
 *
 *   Active materials            → { materialId }
 *   Archived (history)          → { materialId } — archiving never makes past
 *                                 orders unfilterable
 *   Recorded on older orders    → { material: name } — the recorded-name path,
 *                                 for lines written before materials were
 *                                 linked (PO filter only)
 *
 * Choosing one form always clears the other, so the state can never carry two
 * material constraints.
 */
export interface MaterialFilterValue {
  materialId?: string;
  material?: string;
}

const ID = "id:";
const NAME = "name:";

export function MaterialFilterSelect({
  value,
  onChange,
  materials,
  unlinkedNames = [],
  allLabel = "Any material",
  className,
  "aria-label": ariaLabel = "Filter by material",
}: {
  value: MaterialFilterValue;
  onChange: (next: { materialId: string | undefined; material: string | undefined }) => void;
  /** The Material Master, archived rows included (one cached query). */
  materials: Material[];
  /** Recorded names on unlinked PO lines. Omit where there is no such history. */
  unlinkedNames?: string[];
  allLabel?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const intent = materialFilterIntent(value);
  const selected = !intent ? "ALL" : intent.kind === "id" ? ID + intent.materialId : NAME + intent.name;

  const active = materials.filter((m) => m.isActive);
  const archived = materials.filter((m) => !m.isActive);
  // A value from a URL or an older client that is not among the options still
  // has to render as what it is, not as a blank trigger.
  const knownId = intent?.kind === "id" && materials.some((m) => m.id === intent.materialId);
  const knownName = intent?.kind === "name" && unlinkedNames.includes(intent.name);

  function handle(v: string) {
    if (v.startsWith(ID)) onChange({ materialId: v.slice(ID.length), material: undefined });
    else if (v.startsWith(NAME)) onChange({ materialId: undefined, material: v.slice(NAME.length) });
    else onChange({ materialId: undefined, material: undefined });
  }

  return (
    <Select value={selected} onValueChange={handle}>
      {/* One line, truncated: a long or quoted name must not wrap the trigger
          in a half-width filter cell on a phone. */}
      <SelectTrigger
        className={cn("min-w-0 [&>span]:min-w-0 [&>span]:truncate [&>span]:text-left", className)}
        aria-label={ariaLabel}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ALL">{allLabel}</SelectItem>
        {intent?.kind === "id" && !knownId && materials.length > 0 && (
          <SelectItem value={selected}>Unknown material</SelectItem>
        )}
        {intent?.kind === "name" && !knownName && (
          <SelectItem value={selected}>{`Recorded as “${displayMaterialName(intent.name)}”`}</SelectItem>
        )}
        {active.length > 0 && (
          <SelectGroup>
            <SelectLabel>Materials</SelectLabel>
            {active.map((m) => (
              <SelectItem key={m.id} value={ID + m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {archived.length > 0 && (
          <SelectGroup>
            <SelectLabel>Archived</SelectLabel>
            {archived.map((m) => (
              <SelectItem key={m.id} value={ID + m.id}>
                {`${m.name} (archived)`}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {unlinkedNames.length > 0 && (
          <SelectGroup>
            <SelectLabel>Recorded on older orders (not linked)</SelectLabel>
            {unlinkedNames.map((n) => (
              <SelectItem key={n} value={NAME + n}>
                {`“${n}”`}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}

/** Chip text for an active material filter, or null when there is none. */
export function materialFilterLabel(value: MaterialFilterValue, materials: Material[]): string | null {
  const intent = materialFilterIntent(value);
  if (!intent) return null;
  if (intent.kind === "name") return `Recorded as: “${displayMaterialName(intent.name)}”`;
  const m = materials.find((x) => x.id === intent.materialId);
  if (!m) return "Material: …";
  return `Material: ${m.name}${m.isActive ? "" : " (archived)"}`;
}
