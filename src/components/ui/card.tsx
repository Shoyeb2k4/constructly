import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * `min-w-0` is load-bearing, not cosmetic.
 *
 * A grid or flex item defaults to `min-width: auto`, which refuses to shrink
 * below its content's min-content width. A Card holding a long unbreakable row
 * therefore pushes itself WIDER than its column: the dashboard's attention card
 * measured 437px inside a 333px container at 375px, creating an inner scroller
 * that hid the very items it was meant to surface. Cards are used as grid items
 * across the app, so the floor belongs here rather than at each call site.
 */
export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border border-border/70 bg-surface text-foreground shadow-[0_1px_3px_rgba(16,18,29,0.05),0_1px_2px_rgba(16,18,29,0.03)] transition-shadow",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1 p-6", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      className={cn("text-[15px] font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p className={cn("text-sm text-foreground-muted", className)} {...props} />
  );
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center gap-2 p-6 pt-0", className)}
      {...props}
    />
  );
}
