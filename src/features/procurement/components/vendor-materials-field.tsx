"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MultiSelectList } from "@/components/patterns/multi-select-list";
import { useCan } from "@/features/rbac/permission-context";
import { useMaterialMaster } from "../hooks";
import type { Material, VendorMaterialRef } from "../types";
import { MaterialRefChip } from "./material-ref-chip";
import { MaterialSheet } from "./material-sheet";

/**
 * "Which materials does this vendor normally supply?" — picked from the
 * Material Master, never typed.
 *
 * Only ACTIVE materials are offered. A material the vendor was mapped to before
 * it was archived stays in `value` and shows as an Archived chip: hiding it
 * would silently drop the link on the next save, and offering it would let an
 * archived material be chosen afresh. It can be removed like any other.
 *
 * Free text never becomes a material. When no material has exactly the searched
 * name, a user holding `materials.create` gets an explicit "Create …" that opens
 * the normal Add-material form, prefilled; anyone else, finding nothing at all,
 * is told who to ask.
 */
export function VendorMaterialsField({
  value,
  onChange,
  existing = [],
}: {
  /** Selected material ids — the form's single source of truth. */
  value: string[];
  onChange: (ids: string[]) => void;
  /** The vendor's current mappings, so an archived one still has a label. */
  existing?: VendorMaterialRef[];
}) {
  const can = useCan();
  const canCreateMaterial = can("materials.create");
  const { data: active = [], isLoading } = useMaterialMaster({});

  const [query, setQuery] = React.useState("");
  const [createName, setCreateName] = React.useState<string | null>(null);
  // A material created here is selected before the master list has refetched;
  // keep its label locally so the chip is never blank in between.
  const [justCreated, setJustCreated] = React.useState<Material[]>([]);

  const labels = React.useMemo(() => {
    const m = new Map<string, Pick<VendorMaterialRef, "name" | "isActive">>();
    for (const r of existing) m.set(r.id, { name: r.name, isActive: r.isActive });
    for (const a of [...justCreated, ...active]) m.set(a.id, { name: a.name, isActive: true });
    return m;
  }, [existing, active, justCreated]);

  const selected = React.useMemo(() => new Set(value), [value]);
  const q = query.trim().toLowerCase();
  const options = active
    .filter((m) => !q || m.name.toLowerCase().includes(q))
    .map((m) => ({ value: m.id, label: m.name }));

  function toggle(id: string) {
    onChange(selected.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  }

  function onCreated(m: Material) {
    setJustCreated((prev) => [...prev, m]);
    if (!selected.has(m.id)) onChange([...value, m.id]);
    setQuery("");
  }

  let footer: React.ReactNode = null;
  if (isLoading) {
    footer = <p className="text-xs text-foreground-subtle">Loading materials…</p>;
  } else if (active.length === 0) {
    footer = canCreateMaterial ? (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-foreground-subtle">No materials exist yet. Add a material first.</p>
        <Button type="button" variant="secondary" size="sm" onClick={() => setCreateName("")}>
          <Plus />
          Add material
        </Button>
      </div>
    ) : (
      <p className="text-xs text-foreground-subtle">
        No materials are available. Ask someone with material management access to add them.
      </p>
    );
  } else if (q && !active.some((m) => m.name.trim().toLowerCase() === q) && (canCreateMaterial || options.length === 0)) {
    // Create is offered whenever no material has EXACTLY this name — not only
    // when nothing matches at all. Searching "Sand" lists "River Sand" and
    // "M-Sand", and those are different materials (see Pass 1: "Cement" and
    // "OPC Cement" stay separate); a strict no-match rule would make "Sand"
    // impossible to create here. The near matches stay listed above, so picking
    // one remains the easy path. An exact duplicate is refused by the server.
    footer = canCreateMaterial ? (
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
      <p className="text-xs text-foreground-subtle">
        No matching material. Ask someone with material management access to add it.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected materials">
          {value.map((id) => {
            const label = labels.get(id);
            return (
              <li key={id} className="max-w-full">
                <MaterialRefChip
                  material={label ?? { name: "Unknown material", isActive: false }}
                  onRemove={() => onChange(value.filter((x) => x !== id))}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-foreground-subtle">Optional — none selected.</p>
      )}

      <MultiSelectList
        label="Materials"
        options={options}
        selected={selected}
        onToggle={toggle}
        query={query}
        onQueryChange={setQuery}
        searchPlaceholder="Search materials…"
        footer={footer}
      />

      {createName !== null && (
        <MaterialSheet
          open
          defaultName={createName}
          onOpenChange={(o) => !o && setCreateName(null)}
          onSaved={onCreated}
        />
      )}
    </div>
  );
}
