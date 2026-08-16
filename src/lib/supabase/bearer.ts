import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl, supabasePublishableKey } from "@/lib/env";

/**
 * Verify a Supabase access token supplied as `Authorization: Bearer <token>`.
 *
 * Used by the mobile RPC boundary, whose callers run in a Capacitor WebView at
 * `capacitor://localhost` and therefore have no cookies to present. This does a
 * real round-trip to the auth server (`getUser(jwt)`), which validates the
 * signature AND checks the token has not been revoked — it never trusts a
 * locally-decoded JWT payload.
 *
 * Returns the verified auth user id, or null for any invalid/expired token.
 */
export async function verifyBearerToken(token: string): Promise<string | null> {
  if (!token) return null;

  // No session persistence: this client exists only to validate one token.
  const supabase = createClient(supabaseUrl, supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

/** Extract the token from an `Authorization: Bearer <token>` header. */
export function bearerTokenFrom(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}
