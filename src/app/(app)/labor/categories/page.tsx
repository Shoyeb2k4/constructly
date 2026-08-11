import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { CategoriesView } from "@/features/labor/components/categories-view";

export const metadata: Metadata = { title: "Labour types" };

export default async function LabourCategoriesPage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, "labour.view")) redirect("/dashboard");
  return <CategoriesView />;
}
