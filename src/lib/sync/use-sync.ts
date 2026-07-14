"use client";

import { useCallback, useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDB } from "./db";
import { flush } from "./engine";
import { useOnlineStatus } from "./use-online-status";

/**
 * Exposes the pending-mutation count and auto-flushes when connectivity
 * returns. Mount once near the app shell; read `pending` for the indicator.
 */
export function useSync() {
  const online = useOnlineStatus();
  const pending =
    useLiveQuery(
      () => (typeof window === "undefined" ? 0 : getDB().outbox.count()),
      [],
      0,
    ) ?? 0;

  const sync = useCallback(async () => {
    try {
      await flush();
    } catch {
      // Swallowed here; the outbox is retried on the next online event.
    }
  }, []);

  useEffect(() => {
    if (online && pending > 0) void sync();
  }, [online, pending, sync]);

  return { pending, online, sync };
}
