import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isDemoMode } from "@/lib/env";
import { AppShell } from "@/components/shell/app-shell";
import { getLayoutBranding } from "@/features/branding/server/layout-branding";

/** Company-aware title + favicon after login (Constructly before). */
export async function generateMetadata(): Promise<Metadata> {
  const b = await getLayoutBranding();
  return {
    title: { default: b.name, template: `%s · ${b.name}` },
    ...(b.faviconUrl ? { icons: { icon: [{ url: b.faviconUrl }] } } : {}),
  };
}

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

  const branding = await getLayoutBranding();

  return (
    <>
      {/* Company brand colors, injected after globals.css so they win. Empty
          for companies without custom colors ⇒ Constructly defaults. */}
      {branding.colorsCss && (
        <style dangerouslySetInnerHTML={{ __html: `:root{${branding.colorsCss}}` }} />
      )}
      <AppShell user={user} branding={{ name: branding.name, logoUrl: branding.logoUrl }}>
        {children}
      </AppShell>
    </>
  );
}
