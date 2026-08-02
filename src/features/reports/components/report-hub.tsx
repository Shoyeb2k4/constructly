"use client";

import Link from "next/link";
import {
  ArrowRight,
  Scale,
  FolderKanban,
  HardHat,
  ShoppingCart,
  Truck,
  CalendarClock,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { REPORTS } from "../registry";
import { canViewReport } from "../report-meta";
import { useCan } from "@/features/rbac/permission-context";
import type { ReportCategory } from "../types";

const CATEGORY_ICON: Record<ReportCategory, React.ElementType> = {
  Financial: Scale,
  Project: FolderKanban,
  Labour: HardHat,
  Procurement: ShoppingCart,
  Vendor: Truck,
};

const ICON_OVERRIDE: Record<string, React.ElementType> = {
  deadlines: CalendarClock,
};

export function ReportHub() {
  const can = useCan();
  // Only show reports the user may view — financial reports are hidden without
  // reports.view_financial (the server page guard enforces the same).
  const visible = REPORTS.filter((r) => canViewReport(can, r.id));
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {visible.map((r) => {
        const Icon = ICON_OVERRIDE[r.id] ?? CATEGORY_ICON[r.category];
        return (
          <Link key={r.id} href={`/reports/${r.id}`} className="group">
            <Card
              className={cn(
                "h-full p-5 transition-all hover:border-border-strong hover:shadow-sm",
                r.featured && "border-primary/30 bg-primary/[0.03]",
              )}
            >
              <div className="flex items-start justify-between">
                <div className="flex size-9 items-center justify-center rounded-lg bg-surface-muted text-foreground-muted">
                  <Icon className="size-5" />
                </div>
                {r.featured && <Badge variant="primary">Flagship</Badge>}
              </div>
              <h3 className="mt-3 font-medium">{r.name}</h3>
              <p className="mt-1 text-sm text-foreground-muted">{r.description}</p>
              <div className="mt-3 flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                Open report <ArrowRight className="size-3" />
              </div>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
