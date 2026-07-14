"use client";

import { useEffect, useState } from "react";

export interface RecentEntry {
  id: string;
  name: string;
  code: string;
}

const KEY = "constructly.recentProjects.v1";
const MAX = 6;
const EVENT = "constructly:recent-updated";

export function pushRecent(entry: RecentEntry): void {
  if (typeof window === "undefined") return;
  try {
    const list = getRecent().filter((x) => x.id !== entry.id);
    list.unshift(entry);
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* non-fatal */
  }
}

export function getRecent(): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as RecentEntry[];
  } catch {
    return [];
  }
}

/** Reactive list of recently-viewed projects. */
export function useRecentProjects(): RecentEntry[] {
  const [items, setItems] = useState<RecentEntry[]>([]);
  useEffect(() => {
    const sync = () => setItems(getRecent());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return items;
}
