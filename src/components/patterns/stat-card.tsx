import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  hint,
  tone = "default",
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: LucideIcon;
  trend?: { direction: "up" | "down"; value: string; good?: boolean };
  hint?: React.ReactNode;
  /**
   * MEANING, never category. `attention` says "a decision may be needed here";
   * it does not say "this figure is money". Six identical tiles where two were
   * amber for opposite reasons — Currently due and Paid ahead — is what this
   * scale replaces.
   */
  tone?: "default" | "neutral" | "attention" | "warning" | "danger" | "success";
  className?: string;
}) {
  const toneRing =
    tone === "warning" || tone === "attention"
      ? "border-warning/40"
      : tone === "danger"
        ? "border-danger/40"
        : tone === "success"
          ? "border-success/40"
          : "border-border";
  return (
    <div
      className={cn(
        "group rounded-xl border bg-surface p-5 transition-all duration-200 hover:shadow-[0_2px_12px_rgba(16,18,29,0.06)]",
        toneRing,
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-foreground-muted">
          {label}
        </span>
        {Icon && (
          <span className="flex size-8 items-center justify-center rounded-lg bg-surface-muted text-foreground-subtle transition-colors group-hover:text-primary">
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div className="text-[26px] font-semibold leading-none tracking-tight">
          {value}
        </div>
        {trend && (
          <span
            className={cn(
              "flex items-center gap-0.5 text-xs font-medium",
              trend.good ?? trend.direction === "up"
                ? "text-success-foreground"
                : "text-danger-foreground",
            )}
          >
            {trend.direction === "up" ? (
              <ArrowUpRight className="size-3.5" />
            ) : (
              <ArrowDownRight className="size-3.5" />
            )}
            {trend.value}
          </span>
        )}
      </div>
      {hint && (
        <p className="mt-1.5 text-xs text-foreground-subtle">{hint}</p>
      )}
    </div>
  );
}
