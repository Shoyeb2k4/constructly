import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  FolderKanban,
  HardHat,
  Truck,
  ShoppingCart,
  BarChart3,
  Settings,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Roles allowed to see this item. Empty = all authenticated users. */
  roles?: Array<"OWNER" | "PROJECT_MANAGER">;
};

/** Primary application navigation. Order defines sidebar order. */
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Labor", href: "/labor", icon: HardHat },
  { label: "Vendors", href: "/vendors", icon: Truck },
  { label: "Procurement", href: "/procurement", icon: ShoppingCart },
  { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "Settings", href: "/settings", icon: Settings, roles: ["OWNER"] },
];
