import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { MaterialMasterView } from "@/features/procurement/components/material-master-view";

export const metadata: Metadata = { title: "Materials" };

/**
 * The administrative Material Master. Gated on `materials.view` specifically —
 * NOT on the wider read set the server allows for picking a material while
 * raising a purchase order. Being able to choose a material is not the same as
 * being able to administer the catalogue.
 */
export default async function MaterialMasterPage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, "materials.view")) redirect("/dashboard");
  return <MaterialMasterView />;
}
