import { cn } from "@/lib/utils";

export function TagChip({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground-muted",
        className,
      )}
    >
      {label}
    </span>
  );
}
