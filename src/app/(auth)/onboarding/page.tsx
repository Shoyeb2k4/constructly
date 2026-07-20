import { redirect } from "next/navigation";
import { isDemoMode } from "@/lib/env";
import { createServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db/prisma";
import { Logo } from "@/components/shell/logo";
import { OnboardingForm } from "./onboarding-form";

/**
 * First-login workspace setup. Reached when a user is authenticated with
 * Supabase but has no Company/User rows yet (fresh sign-up or OAuth).
 */
export default async function OnboardingPage() {
  if (isDemoMode) redirect("/dashboard");

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const existing = await prisma.user.findUnique({ where: { id: user.id } });
  if (existing) redirect("/dashboard");

  const meta = (user.user_metadata ?? {}) as { full_name?: string; company_name?: string; name?: string };
  const defaultFullName = meta.full_name ?? meta.name ?? "";
  const defaultCompany = meta.company_name ?? "";

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Logo showText={false} className="scale-125" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Set up your company</h1>
            <p className="mt-1 text-sm text-foreground-muted">
              One last step — this creates your workspace as the owner.
            </p>
          </div>
        </div>
        <OnboardingForm defaultFullName={defaultFullName} defaultCompany={defaultCompany} />
      </div>
    </div>
  );
}
