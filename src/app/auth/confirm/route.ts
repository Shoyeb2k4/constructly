import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Email-link confirmation (password recovery, signup, email change).
 *
 * Uses verifyOtp with the token hash instead of the PKCE code exchange, so the
 * link works in ANY browser or device: a customer can request a reset on their
 * laptop and open the email on their phone. PKCE binds a code_verifier to the
 * browser that made the request, which silently breaks cross-device links —
 * /auth/callback is kept for OAuth, where the same browser completes the flow.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/dashboard";

  if (tokenHash && type) {
    const supabase = await createServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      // Only allow same-origin relative redirects.
      const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=auth`);
}
