"use client";

import * as React from "react";
import { Check, Plus, Search } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCan } from "@/features/rbac/permission-context";
import type { Material } from "../types";
import { MaterialSheet } from "./material-sheet";

/**
 * Choose ONE material for a purchase-order line.
 *
 * The vendor's usual materials come first; every other ACTIVE material is
 * always listed below — the vendor mapping is a convenience, never a
 * restriction on what may be ordered. Archived materials are not offered.
 *
 * A second sheet over the PO sheet rather than a popover: a floating layer
 * inside a scrolling sheet is exactly what breaks on a phone, and plain buttons
 * give keyboard support (Tab, Enter/Space) with nothing custom to get wrong.
 */
export function MaterialPickerSheet({
  open,
  onOpenChange,
  vendorName,
  vendorMaterialIds,
  materials,
  selectedId,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vendorName: string;
  /** Ids of the materials this vendor normally supplies. */
  vendorMaterialIds: ReadonlySet<string>;
  /** Every ACTIVE material. Loaded once by the editor, shared by every line. */
  materials: Material[];
  selectedId?: string;
  onSelect: (m: Material) => void;
}) {
  const can = useCan();
  const canCreate = can("materials.create");
  const [query, setQuery] = React.useState("");
  const [createName, setCreateName] = React.useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const matches = materials.filter((m) => !q || m.name.toLowerCase().includes(q));
  const usual = matches.filter((m) => vendorMaterialIds.has(m.id));
  const other = matches.filter((m) => !vendorMaterialIds.has(m.id));
  // Offer Create only when no material has EXACTLY this name — near matches
  // stay listed, so picking one remains the easy path (same rule as Pass 5).
  const exact = !!q && materials.some((m) => m.name.trim().toLowerCase() === q);

  function choose(m: Material) {
    onSelect(m);
    setQuery("");
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Choose material</SheetTitle>
          <SheetDescription>
            {vendorName}&apos;s usual materials are listed first. Any active material can be ordered.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle" />
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // Enter never picks or creates anything implicitly.
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault();
              }}
              placeholder="Search materials…"
              aria-label="Search materials"
              className="h-10 w-full min-w-0 rounded-[var(--radius)] border border-border-strong bg-surface pl-9 pr-3 text-sm outline-none placeholder:text-foreground-subtle focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <Group
            title={`Supplied by ${vendorName}`}
            materials={usual}
            selectedId={selectedId}
            onChoose={choose}
            empty={
              vendorMaterialIds.size === 0
                ? "No usual materials recorded for this vendor."
                : q
                  ? `None of ${vendorName}'s usual materials match.`
                  : null
            }
          />
          <Group
            title="Other materials"
            materials={other}
            selectedId={selectedId}
            onChoose={choose}
            empty={q ? "No other materials match." : "No other active materials."}
          />

          {q && !exact &&
            (canCreate ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto max-w-full justify-start px-1 py-1 text-left"
                onClick={() => setCreateName(query.trim())}
              >
                <Plus className="shrink-0" />
                <span className="truncate">Create “{query.trim()}”</span>
              </Button>
            ) : (
              usual.length + other.length === 0 && (
                <p className="text-xs text-foreground-subtle">
                  No matching material. Ask someone with material management access to add it.
                </p>
              )
            ))}
        </div>

        {createName !== null && (
          <MaterialSheet
            open
            defaultName={createName}
            onOpenChange={(o) => !o && setCreateName(null)}
            onSaved={choose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Group({
  title,
  materials,
  selectedId,
  onChoose,
  empty,
}: {
  title: string;
  materials: Material[];
  selectedId?: string;
  onChoose: (m: Material) => void;
  empty: string | null;
}) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="space-y-1.5">
      <h3 id={id} className="text-xs font-medium uppercase tracking-wide text-foreground-subtle">
        {title}
      </h3>
      {materials.length === 0 ? (
        empty && <p className="text-xs text-foreground-subtle">{empty}</p>
      ) : (
        <ul className="overflow-hidden rounded-[var(--radius)] border border-border">
          {materials.map((m) => {
            const selected = m.id === selectedId;
            const hint = [m.category, m.defaultUnit].filter(Boolean).join(" · ");
            return (
              <li key={m.id} className="border-b border-border last:border-0">
                <button
                  type="button"
                  onClick={() => onChoose(m)}
                  aria-current={selected ? "true" : undefined}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none",
                    selected && "font-medium",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{m.name}</span>
                    {hint && <span className="block truncate text-xs text-foreground-subtle">{hint}</span>}
                  </span>
                  {selected && <Check className="size-4 shrink-0 text-primary" aria-label="Selected" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
