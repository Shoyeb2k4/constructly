import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VendorMaterialRef } from "../types";

/**
 * One mapped material, as the vendor screens show it. An archived material is
 * still SHOWN — hiding a mapping the vendor genuinely has would make the screen
 * lie — but it is marked, so nobody mistakes it for something they can order.
 */
export function MaterialRefChip({
  material,
  onRemove,
  className,
}: {
  material: Pick<VendorMaterialRef, "name" | "isActive">;
  /** When given, the chip carries a remove button. */
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        material.isActive
          ? "bg-surface-muted text-foreground-muted"
          : "border border-dashed border-border-strong text-foreground-subtle",
        className,
      )}
      title={material.isActive ? undefined : "Archived — no longer offered for new orders"}
    >
      <span className={cn("truncate", !material.isActive && "line-through")}>{material.name}</span>
      {!material.isActive && <span className="shrink-0 not-italic">· Archived</span>}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${material.name}`}
          className="shrink-0 rounded-sm text-foreground-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

/**
 * Names an older app version recorded for a vendor that match no Material
 * Master record. Shown so they are never lost silently; they cannot be picked
 * here because they are not materials — adding one to the Material Master and
 * then selecting it links it.
 */
export function UnlinkedMaterialNames({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <p className="text-xs text-foreground-subtle">
      Also recorded by an older version of the app, not yet in the Material Master:{" "}
      <span className="text-foreground-muted">{names.join(", ")}</span>
    </p>
  );
}
