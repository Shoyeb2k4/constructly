"use client";

import * as React from "react";

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * `false` while rendering on the server and during React's hydration pass,
 * `true` from the first client render onward.
 *
 * WHY A SCREEN NEEDS THIS
 *
 * A view whose data lives only in the browser — the demo repository reads
 * localStorage, and React Query has no server snapshot — renders one thing on
 * the server and, if the query has resolved by the time React gets round to
 * hydrating that subtree, something else on the client. React cannot patch that
 * up: it discards the server tree and re-renders the whole branch, logging a
 * hydration mismatch. Attendance did exactly this on every load, rendering
 * "No active projects" server-side and the full sheet client-side.
 *
 * Gating on this makes the server render and the hydration render agree by
 * construction, whatever the query did in between. `useSyncExternalStore` is
 * the mechanism React provides for it — unlike a `useState` + `useEffect` flag,
 * it is honest about being an external value and does not set state in an
 * effect.
 */
export function useIsHydrated(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
