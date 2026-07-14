"use client";

import * as React from "react";
import { Cloud, CloudOff, RefreshCw } from "lucide-react";
import { useOnlineStatus } from "@/lib/sync/use-online-status";
import { cn } from "@/lib/utils";

/**
 * Persistent, subtle connection indicator for the topbar. Shows offline state
 * and pending sync count. Field-capture flows (attendance, quick PO, notes)
 * queue locally when offline (see lib/sync).
 */
export function OfflineIndicator({ pending = 0 }: { pending?: number }) {
  const online = useOnlineStatus();

  if (online && pending === 0) {
    return (
      <span
        className="hidden items-center gap-1.5 text-xs text-foreground-subtle sm:flex"
        title="All changes synced"
      >
        <Cloud className="size-3.5" />
        Synced
      </span>
    );
  }

  if (!online) {
    return (
      <span
        className={cn(
          "flex items-center gap-1.5 rounded-full bg-warning-subtle px-2.5 py-1 text-xs font-medium text-warning-foreground",
        )}
      >
        <CloudOff className="size-3.5" />
        Offline{pending > 0 ? ` · ${pending} pending` : ""}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 rounded-full bg-info-subtle px-2.5 py-1 text-xs font-medium text-info-foreground">
      <RefreshCw className="size-3.5 animate-spin" />
      Syncing {pending}
    </span>
  );
}
