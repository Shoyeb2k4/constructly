/** Presentation helpers for the projects feature. */

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return dateFmt.format(new Date(iso));
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

export type CountdownTone = "default" | "warning" | "danger" | "done";

/** Days until (or since) a due date, with a tone for styling. */
export function deadlineCountdown(
  dueDate: string | null,
  completed = false,
): { label: string; tone: CountdownTone } {
  if (completed) return { label: "Done", tone: "done" };
  if (!dueDate) return { label: "No deadline", tone: "default" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: "danger" };
  if (days === 0) return { label: "Due today", tone: "danger" };
  if (days <= 14) return { label: `${days}d left`, tone: "warning" };
  return { label: `${days}d left`, tone: "default" };
}

export function budgetPct(usedPaise: number, budgetPaise: number): number {
  if (budgetPaise <= 0) return 0;
  return Math.min(100, Math.round((usedPaise / budgetPaise) * 100));
}
