/** Environment capability flags. Keep all env branching in one place. */

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

/**
 * Publishable API key. Supabase now issues `sb_publishable_...` keys; the
 * legacy JWT "anon" key is still supported — accept either env name so both
 * key formats work without code changes.
 */
export const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

/**
 * Demo mode serves a seeded demo company without real auth. Active when
 * explicitly enabled OR when Supabase is not configured — so the UI always
 * previews and E2E tests can run without a backend.
 */
export const isDemoMode =
  process.env.CONSTRUCTLY_DEMO === "1" || !isSupabaseConfigured;
