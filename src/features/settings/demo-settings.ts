"use client";

/** Demo-mode company settings persisted locally so the PO approval toggle
 *  actually affects procurement budget counting (see budget/spend). */

const KEY = "constructly.demo.settings.v1";
const EVENT = "constructly:settings";

export function getApprovalRequired(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}").poApprovalRequired ?? true;
  } catch {
    return true;
  }
}

export function setApprovalRequired(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ poApprovalRequired: value }));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* non-fatal */
  }
}

export function subscribeSettings(callback: () => void): () => void {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
