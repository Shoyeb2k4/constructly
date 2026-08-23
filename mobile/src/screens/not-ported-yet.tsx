import * as React from "react";
import { Construction } from "lucide-react";

/**
 * Honest placeholder for routes that exist on the web but have not yet been
 * ported to the native app. Phase 1 deliberately proves the architecture on one
 * vertical slice rather than shipping seven half-working modules.
 */
export function NotPortedYet({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <Construction className="size-8 text-foreground-subtle" />
      <h1 className="text-base font-semibold">{title}</h1>
      <p className="max-w-xs text-sm text-foreground-muted">
        This module is available on the web app and has not been ported to iOS yet.
      </p>
    </div>
  );
}
