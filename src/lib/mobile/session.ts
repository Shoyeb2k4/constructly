import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl, supabasePublishableKey } from "@/lib/env";

/**
 * Supabase client for the NATIVE app.
 *
 * The web app uses `@supabase/ssr`'s `createBrowserClient`, which persists the
 * session in cookies so the Next.js server can read it. Inside Capacitor there
 * is no Next.js server on the origin and cookie behaviour on
 * `capacitor://localhost` is unreliable under WKWebView's storage policies — so
 * the native app keeps the session client-side and presents it explicitly as a
 * bearer token on every RPC call.
 *
 * DELIBERATELY FREE OF CAPACITOR IMPORTS. This module is reachable from the
 * ordinary Next.js client graph (`features/*​/data.ts` → `http-repository` →
 * `rpc` → here), so importing `@capacitor/core` at this level would drag the
 * native runtime into the web bundle. The native pieces are injected instead:
 * `mobile/src/native/` calls `configureMobileAuth()` during bootstrap.
 */

/** Minimal async storage contract — matches what supabase-js expects, and what
 *  a Keychain-backed native store can actually provide. */
export interface MobileAuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

let storage: MobileAuthStorage | undefined;
let client: SupabaseClient | null = null;

/**
 * Install the platform's session store. Must run before the first
 * `getMobileSupabase()` call, because supabase-js reads storage when the client
 * is constructed. Without it the client falls back to WebView localStorage,
 * which is fine for a browser preview but is NOT where a real session belongs.
 */
export function configureMobileAuth(options: { storage: MobileAuthStorage }): void {
  storage = options.storage;
  // A later reconfigure must not leave a client bound to the old store.
  client = null;
}

export function getMobileSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // The native app has no URL bar; OAuth returns through a deep link and
        // is exchanged explicitly, so nothing should be parsed from the URL.
        detectSessionInUrl: false,
        // PKCE keeps the code verifier in THIS client's storage, so the code
        // exchange must also happen here — never on a server route, which
        // would not own the verifier.
        flowType: "pkce",
        ...(storage ? { storage } : {}),
      },
    });
  }
  return client;
}

/** True once a platform store has been installed. */
export function hasMobileAuthStorage(): boolean {
  return storage !== undefined;
}

/**
 * Current access token, refreshed first if it has expired.
 *
 * Read through supabase-js on every call rather than cached: the library
 * rotates the token in the background, and a cached copy would keep being sent
 * after a refresh (and, worse, after sign-out).
 */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await getMobileSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Sign out and drop every trace of the session.
 *
 * `signOut()` clears supabase-js's own persisted entry; the storage sweep below
 * is belt and braces for any auth key the library wrote under a different
 * project ref (e.g. after an env change), so a stale refresh token can never
 * outlive a logout.
 */
export async function signOutMobile(): Promise<void> {
  try {
    await getMobileSupabase().auth.signOut({ scope: "local" });
  } finally {
    if (storage) {
      const ref = supabaseUrl.replace(/^https?:\/\//, "").split(".")[0];
      await Promise.all(
        [`sb-${ref}-auth-token`, "supabase.auth.token"].map((k) =>
          storage!.removeItem(k).catch(() => {}),
        ),
      );
    }
  }
}
