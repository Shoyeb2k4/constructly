"use client";

import { CloudCheck, CloudOff } from "lucide-react";
import { useOnlineStatus } from "@/lib/sync/use-online-status";
import { cn } from "@/lib/utils";

/** Attendance sync status. Writes are local-first, so data is never lost. */
export function SyncChip({ pending = 0 }: { pending?: number }) {
  const online = useOnlineStatus();
  if (!online) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-warning-subtle px-2.5 py-1 text-xs font-medium text-warning-foreground">
        <CloudOff className="size-3.5" />
        Offline · saved on device
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        pending > 0
          ? "bg-info-subtle text-info-foreground"
          : "bg-success-subtle text-success-foreground",
      )}
    >
      <CloudCheck className="size-3.5" />
      {pending > 0 ? `Syncing ${pending}` : "Saved"}
    </span>
  );
}
