"use client";

const KEY = "constructly.attendance.lastProject.v1";

/** Remembers the last project used for attendance (per the spec). */
export function getLastProject(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setLastProject(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    /* non-fatal */
  }
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
