import * as React from "react";
import { cn } from "@/lib/utils";

export function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 py-2 text-sm shadow-sm transition-colors",
        "placeholder:text-foreground-subtle",
        "focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
