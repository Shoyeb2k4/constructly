import Link from "next/link";
import { FolderKanban, HardHat, ShoppingCart, Truck, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { relativeTime } from "@/features/projects/format";
import type { ActivityKind, DashActivity } from "../types";

const ICON: Record<ActivityKind, React.ElementType> = {
  project: FolderKanban,
  attendance: HardHat,
  purchase_order: ShoppingCart,
  vendor: Truck,
};

export function ActivityFeed({ items }: { items: DashActivity[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Activity className="size-7 text-foreground-subtle" />
            <p className="text-sm text-foreground-muted">No activity yet</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {items.map((a) => {
              const Icon = ICON[a.kind];
              return (
                <li key={a.id}>
                  <Link href={a.href} className="flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-muted/50">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-muted text-foreground-subtle">
                      <Icon className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-sm leading-snug">
                        {a.actorName && <span className="font-medium">{a.actorName} </span>}
                        <span className="text-foreground-muted">{a.summary}</span>
                      </span>
                      <span className="mt-0.5 block text-xs text-foreground-subtle">{relativeTime(a.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
