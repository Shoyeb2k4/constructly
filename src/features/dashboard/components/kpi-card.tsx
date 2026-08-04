import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Actionable KPI — always drills down to its module. Reads top-to-bottom:
 *  metric → label → supporting context, scannable in under two seconds. */
export function KpiCard({
  label,
  value,
  hint,
  sub,
  icon: Icon,
  href,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  /** Muted supporting line (e.g. "of ₹1,10,20,000"). */
  hint?: React.ReactNode;
  /** Emphasised context line (e.g. "34% of budget"). */
  sub?: React.ReactNode;
  icon: LucideIcon;
  href: string;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex flex-col rounded-xl border bg-surface p-5 shadow-[0_1px_2px_rgba(16,18,29,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(16,18,29,0.08)]",
        tone === "warning" ? "border-warning/30" : tone === "danger" ? "border-danger/30" : "border-border",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "flex size-9 items-center justify-center rounded-lg transition-colors",
            tone === "warning"
              ? "bg-warning-subtle text-warning-foreground"
              : tone === "danger"
                ? "bg-danger-subtle text-danger-foreground"
                : "bg-surface-muted text-foreground-subtle group-hover:text-primary",
          )}
        >
          <Icon className="size-4" />
        </span>
        <ArrowUpRight className="size-4 -translate-x-1 text-foreground-subtle opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
      </div>
      <div
        className={cn(
          "mt-4 whitespace-nowrap text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums",
          tone === "danger" && "text-danger-foreground",
          tone === "warning" && "text-warning-foreground",
        )}
      >
        {value}
      </div>
      <p className="mt-2 text-[13px] font-medium text-foreground">{label}</p>
      {sub && <p className="mt-1 text-xs font-medium text-foreground-muted">{sub}</p>}
      {hint && <p className="mt-0.5 text-xs text-foreground-subtle">{hint}</p>}
    </Link>
  );
}
