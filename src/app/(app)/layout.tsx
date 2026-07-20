import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isDemoMode } from "@/lib/env";
import { AppShell } from "@/components/shell/app-shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) {
    // Authenticated with Supabase but no workspace yet → finish onboarding;
    // otherwise this is an anonymous visitor → sign in.
    if (!isDemoMode) {
      const { createServerClient } = await import("@/lib/supabase/server");
      const supabase = await createServerClient();
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (authUser) redirect("/onboarding");
    }
    redirect("/sign-in");
  }
  return <AppShell user={user}>{children}</AppShell>;
}
