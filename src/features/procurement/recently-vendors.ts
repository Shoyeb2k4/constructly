"use client";

import { useEffect, useState } from "react";

export interface RecentVendor {
  id: string;
  name: string;
}

const KEY = "constructly.recentVendors.v1";
const MAX = 5;
const EVENT = "constructly:recent-vendors";

export function pushRecentVendor(entry: RecentVendor): void {
  if (typeof window === "undefined") return;
  try {
    const list = getRecentVendors().filter((x) => x.id !== entry.id);
    list.unshift(entry);
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* non-fatal */
  }
}

export function getRecentVendors(): RecentVendor[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as RecentVendor[];
  } catch {
    return [];
  }
}

export function useRecentVendors(): RecentVendor[] {
  const [items, setItems] = useState<RecentVendor[]>([]);
  useEffect(() => {
    const sync = () => setItems(getRecentVendors());
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return items;
}
