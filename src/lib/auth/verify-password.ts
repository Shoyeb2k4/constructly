import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl, supabasePublishableKey } from "@/lib/env";

/**
 * Re-authenticate a user by verifying their password WITHOUT disturbing the
 * current request session. Uses a throwaway client with no session persistence
 * (never bound to the request cookies), so the caller's session is untouched —
 * this is a pure credential check that gates sensitive actions such as the
 * permanent project deletion flow. Returns true only on a valid email+password.
 */
export async function verifyPassword(email: string, password: string): Promise<boolean> {
  if (!supabaseUrl || !supabasePublishableKey) return false;
  if (!password) return false;
  const client = createClient(supabaseUrl, supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  // Drop the ephemeral session we just minted (best-effort; it's not persisted).
  await client.auth.signOut().catch(() => {});
  return !error;
}
