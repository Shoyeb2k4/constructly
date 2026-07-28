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
    if (!isDemoMode) {
      const { createServerClient } = await import("@/lib/supabase/server");
      const supabase = await createServerClient();
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (authUser) {
        // A row exists but getCurrentUser returned null ⇒ the member is
        // deactivated. No row ⇒ they either have a pending invite to accept or
        // still need to create a workspace.
        const { prisma } = await import("@/lib/db/prisma");
        const row = await prisma.user.findUnique({ where: { id: authUser.id }, select: { id: true } });
        if (row) redirect("/deactivated");
        const { getPendingInviteForMe } = await import("@/features/team/server/actions");
        const invite = await getPendingInviteForMe();
        redirect(invite ? "/accept-invite" : "/onboarding");
      }
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
