import type { Metadata } from "next";
import { CategoriesView } from "@/features/labor/components/categories-view";

export const metadata: Metadata = { title: "Labour categories" };

export default function LabourCategoriesPage() {
  return <CategoriesView />;
}
