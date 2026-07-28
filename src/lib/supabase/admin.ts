import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl } from "@/lib/env";

let cached: SupabaseClient | null = null;

/**
 * Service-role Supabase client for server-only, non-user-scoped work (e.g.
 * signing branding asset URLs inside a cache, where request cookies aren't
 * available). Returns null when the service key isn't configured. NEVER expose
 * this to the browser or use it to bypass tenant checks — callers must scope by
 * companyId themselves.
 */
export function createAdminClient(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !supabaseUrl) return null;
  if (!cached) {
    cached = createClient(supabaseUrl, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

function requireAdmin(): SupabaseClient {
  const admin = createAdminClient();
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return admin;
}

/**
 * Invite a user by email — creates the auth user (unconfirmed, no password) and
 * sends Supabase's invite email. `data` becomes user_metadata; `redirectTo`
 * points the email link at the accept page. Returns the new auth user id.
 */
export async function adminInviteUser(
  email: string,
  data: Record<string, unknown>,
  redirectTo?: string,
): Promise<{ userId: string | null }> {
  const { data: res, error } = await requireAdmin().auth.admin.inviteUserByEmail(email, {
    data,
    ...(redirectTo ? { redirectTo } : {}),
  });
  if (error) throw new Error(error.message);
  return { userId: res.user?.id ?? null };
}

/** Permanently delete an auth user (ignores "not found"). */
export async function adminDeleteUser(userId: string): Promise<void> {
  const { error } = await requireAdmin().auth.admin.deleteUser(userId);
  if (error && !/not found/i.test(error.message)) throw new Error(error.message);
}
