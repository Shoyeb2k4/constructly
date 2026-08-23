import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { getMobileSupabase, signOutMobile } from "@/lib/mobile/session";
import { parseAuthCallback, type AuthCallback } from "@/lib/mobile/auth-callback";
import { googleOAuthRequest } from "@/lib/mobile/oauth-request";

/**
 * Native authentication glue.
 *
 * The web app's Google button uses `redirectTo: window.location.origin`, which
 * under Capacitor evaluates to `capacitor://localhost` — a scheme Google
 * rejects as a redirect URI. The native flow therefore differs in exactly one
 * place, the redirect target, and is otherwise the same Supabase PKCE flow.
 *
 * PKCE OWNERSHIP IS THE WHOLE POINT: `signInWithOAuth` makes supabase-js
 * generate a code verifier and persist it in this client's storage. The
 * authorization code that comes back can therefore only be redeemed here, on
 * this client. Moving the exchange to a server route — as the WEB app correctly
 * does at `/auth/callback`, where the browser owns the verifier — would break
 * it, because the server never saw this verifier.
 */

export type OAuthOutcome =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Start Google sign-in.
 *
 * `skipBrowserRedirect` keeps supabase-js from navigating the WebView itself:
 * the authorization URL must open in the system browser, both because Google
 * blocks embedded WebViews for OAuth and so the user can see the real URL bar.
 * The flow completes asynchronously when iOS hands the callback URL back
 * through `appUrlOpen`.
 */
export async function startGoogleSignIn(): Promise<OAuthOutcome> {
  // Request shape lives in a pure module so it can be unit-tested and reused by
  // the provider-verification script — and so the redirect target cannot be
  // influenced by anything at runtime.
  const { data, error } = await getMobileSupabase().auth.signInWithOAuth(googleOAuthRequest());

  if (error) return { ok: false, reason: error.message };
  if (!data?.url) return { ok: false, reason: "Supabase did not return an authorization URL" };

  await Browser.open({ url: data.url, presentationStyle: "popover" });
  return { ok: true };
}

/**
 * Complete whatever kind of auth link iOS just handed us.
 *
 * Returns the classification so the caller can react (refresh the session,
 * route to the reset screen, show an error) without this module knowing
 * anything about the UI.
 */
export async function completeAuthCallback(rawUrl: string): Promise<AuthCallback> {
  const parsed = parseAuthCallback(rawUrl);
  const supabase = getMobileSupabase();

  if (parsed.kind === "oauth-code") {
    // Dismiss the system browser first so the user is not left staring at a
    // finished OAuth page while the app works behind it.
    await Browser.close().catch(() => {});
    const { error } = await supabase.auth.exchangeCodeForSession(parsed.code);
    if (error) return { kind: "error", reason: error.message };
    return parsed;
  }

  if (parsed.kind === "email-token") {
    // Same mechanism the web route `/auth/confirm` uses: a token hash, not a
    // PKCE code, so the link still works when opened on another device.
    const { error } = await supabase.auth.verifyOtp({
      type: parsed.type as "recovery" | "signup" | "email_change" | "invite" | "magiclink",
      token_hash: parsed.tokenHash,
    });
    if (error) return { kind: "error", reason: error.message };
    return parsed;
  }

  if (parsed.kind === "error") {
    await Browser.close().catch(() => {});
  }
  return parsed;
}

/**
 * Subscribe to deep links. Returns an unsubscribe function.
 *
 * Registered once at bootstrap, before React renders, so a cold start opened
 * *by* a link is not missed.
 */
export async function listenForAuthLinks(
  onResult: (result: AuthCallback) => void,
): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {};

  const handle = await App.addListener("appUrlOpen", (event) => {
    void completeAuthCallback(event.url).then(onResult);
  });

  return () => void handle.remove();
}

/**
 * Sign out completely: Supabase session, persisted Keychain material, and the
 * system browser's leftover OAuth tab.
 */
export async function signOutNative(): Promise<void> {
  await signOutMobile();
  if (Capacitor.isNativePlatform()) {
    await Browser.close().catch(() => {});
  }
}
