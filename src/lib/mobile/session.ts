import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl, supabasePublishableKey } from "@/lib/env";

/**
 * Supabase client for the NATIVE app.
 *
 * The web app uses `@supabase/ssr`'s `createBrowserClient`, which persists the
 * session in cookies so the Next.js server can read it. Inside Capacitor there
 * is no Next.js server on the origin and cookie behaviour on
 * `capacitor://localhost` is unreliable under WKWebView's storage policies — so
 * the native app keeps the session client-side and sends it explicitly as a
 * bearer token on every RPC call.
 *
 * `detectSessionInUrl` is off because the native app has no URL bar: the OAuth
 * callback arrives through a deep link and is exchanged explicitly.
 *
 * HARDENING (Phase 2+): storage currently falls back to WebView localStorage.
 * Move it to a `@capacitor/preferences` adapter backed by the iOS Keychain
 * before TestFlight, so refresh tokens are not readable from the WebView.
 */
let client: SupabaseClient | null = null;

export function getMobileSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

/** Current access token, refreshing it first if it has expired. Null when signed out. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await getMobileSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}
