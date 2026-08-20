import * as React from "react";
import { AlertTriangle, Info, Ban, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

type CalloutTone = "info" | "attention" | "blocked" | "success" | "neutral";

const TONES: Record<CalloutTone, { wrap: string; icon: React.ElementType; iconClass: string }> = {
  info: { wrap: "border-info/30 bg-info-subtle text-info-foreground", icon: Info, iconClass: "text-info-foreground" },
  attention: {
    wrap: "border-warning/30 bg-warning-subtle text-warning-foreground",
    icon: AlertTriangle,
    iconClass: "text-warning-foreground",
  },
  blocked: { wrap: "border-danger/30 bg-danger-subtle text-danger-foreground", icon: Ban, iconClass: "text-danger-foreground" },
  success: {
    wrap: "border-success/30 bg-success-subtle text-success-foreground",
    icon: CheckCircle2,
    iconClass: "text-success-foreground",
  },
  neutral: { wrap: "border-border bg-surface-muted text-foreground-muted", icon: Info, iconClass: "text-foreground-subtle" },
};

/**
 * A short block of consequence: what a state means, or why an action is
 * refused.
 *
 * Every financial sheet had grown its own spelling of "here is a warning" and
 * "here is why this is blocked", which is how two of them ended up as 12px grey
 * paragraphs that failed contrast. One shape, one tone scale, and the tone is
 * chosen for MEANING — `attention` is not "this is money", it is "look at this".
 */
export function Callout({
  tone = "info",
  title,
  icon: IconOverride,
  children,
  className,
}: {
  tone?: CalloutTone;
  title?: React.ReactNode;
  icon?: React.ElementType;
  children?: React.ReactNode;
  className?: string;
}) {
  const spec = TONES[tone];
  const Icon = IconOverride ?? spec.icon;
  return (
    <div className={cn("flex gap-3 rounded-lg border p-3 text-sm", spec.wrap, className)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", spec.iconClass)} aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-[13px] leading-relaxed">{children}</div>}
      </div>
    </div>
  );
}
