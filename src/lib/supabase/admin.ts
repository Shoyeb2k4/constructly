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
