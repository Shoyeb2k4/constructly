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
 *
 * BOTH flags are read on purpose. `CONSTRUCTLY_DEMO` is server-only: Next never
 * inlines an unprefixed variable into the client bundle, so with it alone the
 * server renders as the demo company while the browser falls through to real
 * server actions — a split-brain that looks like demo mode until the first
 * mutation hits a real database. `NEXT_PUBLIC_CONSTRUCTLY_DEMO` is what makes
 * the client agree.
 *
 * Set BOTH to preview demo mode with Supabase still configured. Neither belongs
 * in a production environment.
 */
export const isDemoMode =
  process.env.CONSTRUCTLY_DEMO === "1" ||
  process.env.NEXT_PUBLIC_CONSTRUCTLY_DEMO === "1" ||
  !isSupabaseConfigured;
