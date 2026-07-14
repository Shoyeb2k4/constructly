import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { AppShell } from "@/components/shell/app-shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return <AppShell user={user}>{children}</AppShell>;
}
