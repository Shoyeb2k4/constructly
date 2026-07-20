import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

/**
 * OAuth / email-link callback. Exchanges the PKCE code for a session, then
 * hands off to the app — getCurrentUser() decides between /dashboard and
 * /onboarding (no workspace yet).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Only allow same-origin relative redirects.
      const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=auth`);
}
