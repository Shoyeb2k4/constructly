import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SettingsView } from "./settings-view";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await getCurrentUser();
  return <SettingsView isOwner={user?.role === "OWNER"} role={user?.role ?? "PROJECT_MANAGER"} />;
}
