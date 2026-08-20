"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  vertical,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & {
  /** Styling only — Radix takes the real `orientation` on the Tabs root. */
  vertical?: boolean;
}) {
  return (
    <TabsPrimitive.List
      className={cn(
        "gap-1 rounded-lg bg-surface-muted p-1 text-foreground-muted",
        // A vertical list is a RAIL: it grows with its items instead of being
        // pinned to one row height, which is what forced ten tabs into a
        // horizontally scrolling strip where the last three were unreachable.
        vertical ? "flex flex-col items-stretch" : "inline-flex h-9 items-center",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        "data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("mt-4 outline-none", className)}
      {...props}
    />
  );
}
