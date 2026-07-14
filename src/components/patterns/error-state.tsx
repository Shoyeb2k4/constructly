"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this. Try again in a moment.",
  onRetry,
  detail,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  detail?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-danger/30 bg-danger-subtle/40 px-6 py-14 text-center",
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-xl bg-danger-subtle text-danger-foreground">
        <AlertTriangle className="size-6" />
      </div>
      <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-foreground-muted">
        {description}
      </p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      )}
      {detail && (
        <details className="mt-4 max-w-md text-left">
          <summary className="cursor-pointer text-xs text-foreground-subtle">
            Technical details
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-surface-muted p-3 text-xs text-foreground-muted">
            {detail}
          </pre>
        </details>
      )}
    </div>
  );
}
