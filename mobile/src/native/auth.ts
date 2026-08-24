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
 * URLs already handed to `completeAuthCallback`.
 *
 * An authorization code is single-use: redeeming it twice fails, and the second
 * failure would be reported to the user as a broken sign-in even though the
 * first one worked. Two sources feed this module (the launch intent and
 * `appUrlOpen`), so the guard is necessary rather than defensive.
 */
const handled = new Set<string>();

/**
 * Subscribe to deep links. Returns an unsubscribe function.
 *
 * TWO SOURCES, BECAUSE ANDROID HAS TWO PATHS.
 *
 * `appUrlOpen` fires from the App plugin's `handleOnNewIntent` ONLY — that is,
 * when the activity already exists and is handed a new intent. It is the warm
 * path, and it was the only one this function listened to.
 *
 * A cold start is different. If Android kills the app while the user is away in
 * the system browser — entirely ordinary on a low-memory device — the redirect
 * LAUNCHES the activity instead of re-entering it. The intent then arrives
 * through `onCreate`, `onNewIntent` is never called, no `appUrlOpen` is ever
 * emitted, and the authorization code is dropped in silence: no session, no
 * error, just the sign-in screen again.
 *
 * Capacitor exposes that intent separately as `getLaunchUrl()`. Reading it here
 * closes the gap. Both paths funnel through `handled`, so a URL delivered by
 * both is redeemed once.
 */
export async function listenForAuthLinks(
  onResult: (result: AuthCallback) => void,
): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {};

  const deliver = (url: string) => {
    if (handled.has(url)) return;
    handled.add(url);
    void completeAuthCallback(url).then(onResult);
  };

  const handle = await App.addListener("appUrlOpen", (event) => deliver(event.url));

  // The intent that started this process, if any. Checked AFTER the listener is
  // registered so neither path can race the other into an unhandled state.
  try {
    const launch = await App.getLaunchUrl();
    if (launch?.url) deliver(launch.url);
  } catch {
    // No launch URL is the normal case; never let it block start-up.
  }

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
