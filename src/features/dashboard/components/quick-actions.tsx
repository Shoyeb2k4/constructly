import Link from "next/link";
import { Plus, CalendarCheck, ShoppingCart, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";

const ACTIONS = [
  { label: "New project", href: "/projects", icon: Plus, primary: true },
  { label: "Record attendance", href: "/labor", icon: CalendarCheck },
  { label: "New PO", href: "/procurement", icon: ShoppingCart },
  { label: "Add vendor", href: "/vendors", icon: Truck },
];

export function QuickActions() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {ACTIONS.map((a) => (
        <Button key={a.href} asChild variant={a.primary ? "primary" : "secondary"} size="sm">
          <Link href={a.href}>
            <a.icon />
            {a.label}
          </Link>
        </Button>
      ))}
    </div>
  );
}
