import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  FolderKanban,
  HardHat,
  Truck,
  ShoppingCart,
  Banknote,
  BarChart3,
  Settings,
} from "lucide-react";
import type { PermissionModule } from "@/features/rbac/permissions";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Modules that make this item visible — shown if the user can access ANY of
   *  them (holds any permission within). Omitted = visible to all. */
  modules?: PermissionModule[];
};

/** Primary application navigation. Order defines sidebar order. */
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Projects", href: "/projects", icon: FolderKanban, modules: ["projects"] },
  { label: "Labor", href: "/labor", icon: HardHat, modules: ["labour", "attendance"] },
  { label: "Vendors", href: "/vendors", icon: Truck, modules: ["vendors"] },
  { label: "Procurement", href: "/procurement", icon: ShoppingCart, modules: ["purchase_orders"] },
  // Payments sits with the operational modules that FEED it, above Reports:
  // finding a transaction is day-to-day work, analysing them is not.
  { label: "Payments", href: "/payments", icon: Banknote, modules: ["payments"] },
  { label: "Reports", href: "/reports", icon: BarChart3, modules: ["reports"] },
  // Settings is always shown — every user has a personal profile section there.
  { label: "Settings", href: "/settings", icon: Settings },
];
