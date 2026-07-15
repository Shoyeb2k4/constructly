import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Actionable KPI — always drills down to its module. */
export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon: LucideIcon;
  href: string;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group rounded-xl border bg-surface p-4 transition-all duration-200 hover:shadow-[0_2px_12px_rgba(16,18,29,0.06)]",
        tone === "warning" ? "border-warning/30" : tone === "danger" ? "border-danger/30" : "border-border",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="flex size-8 items-center justify-center rounded-lg bg-surface-muted text-foreground-subtle transition-colors group-hover:text-primary">
          <Icon className="size-4" />
        </span>
        <ArrowUpRight className="size-4 text-foreground-subtle opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div
        className={cn(
          "mt-3 text-2xl font-semibold leading-none tracking-tight",
          tone === "danger" && "text-danger-foreground",
          tone === "warning" && "text-warning-foreground",
        )}
      >
        {value}
      </div>
      <p className="mt-1.5 text-[13px] font-medium text-foreground-muted">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-foreground-subtle">{hint}</p>}
    </Link>
  );
}
