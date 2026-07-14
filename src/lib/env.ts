/** Environment capability flags. Keep all env branching in one place. */

export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

/**
 * Demo mode serves a seeded demo company without real auth. Active when
 * explicitly enabled OR when Supabase is not configured — so the UI always
 * previews and E2E tests can run without a backend.
 */
export const isDemoMode =
  process.env.CONSTRUCTLY_DEMO === "1" || !isSupabaseConfigured;
