import type { Metadata } from "next";
import { LaborersView } from "@/features/labor/components/laborers-view";

export const metadata: Metadata = { title: "Workers" };

export default function WorkersPage() {
  return <LaborersView />;
}
