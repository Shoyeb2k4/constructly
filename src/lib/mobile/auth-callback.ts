/**
 * Deep-link parsing for the native app.
 *
 * Two DIFFERENT kinds of link arrive here and must not be conflated:
 *
 *  1. OAUTH CALLBACK — a custom-scheme URL the app itself asked for, returning
 *     from Google in the same session that created the PKCE verifier. Always
 *     lands on this device, in this install.
 *
 *  2. EMAIL LINK (password reset / confirmation) — an https URL from an email,
 *     which the user may open on a different device or browser entirely. It
 *     carries a `token_hash` for Supabase's `verifyOtp`, NOT a PKCE code,
 *     precisely because PKCE would break cross-device delivery. The existing
 *     web route `/auth/confirm` already works this way and is reused.
 *
 * Pure functions, no Capacitor: this is the part worth unit-testing, and it
 * must stay runnable outside a device.
 */

/**
 * Custom URL scheme for OAuth returns. Must match `CFBundleURLTypes` in
 * `ios/App/App/Info.plist` and the redirect allow-list in Supabase Auth.
 * Derived from the bundle identifier so the two cannot drift apart.
 */
export const MOBILE_URL_SCHEME = "in.co.constructly.app";

/** Where Google/Supabase send the browser back to after authentication. */
export const OAUTH_CALLBACK_URL = `${MOBILE_URL_SCHEME}://auth/callback`;

export type AuthCallback =
  /** PKCE authorization code — exchange it on the client that started the flow. */
  | { kind: "oauth-code"; code: string }
  /** Email link for recovery/confirmation — hand to `verifyOtp`. */
  | { kind: "email-token"; tokenHash: string; type: string; next: string | null }
  /** The provider or Supabase reported a failure. */
  | { kind: "error"; reason: string }
  /** Nothing to do — not an auth link. Must never be treated as a failure. */
  | { kind: "ignored" };

/**
 * Classify a URL handed to the app by iOS.
 *
 * Deliberately conservative: anything unrecognised is `ignored` rather than an
 * error, so an unrelated deep link can never knock an authenticated user out of
 * the app; but a link that IS ours and is malformed is a hard error rather than
 * being silently swallowed.
 */
export function parseAuthCallback(rawUrl: string): AuthCallback {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: "ignored" };
  }

  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  const isOurScheme = scheme === MOBILE_URL_SCHEME.toLowerCase();
  const isHttps = scheme === "https";

  if (!isOurScheme && !isHttps) return { kind: "ignored" };

  // Supabase reports provider failures as query OR fragment parameters.
  const params = new URLSearchParams(url.search);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const pick = (key: string) => params.get(key) ?? fragment.get(key);

  const errorCode = pick("error") ?? pick("error_code");
  if (errorCode) {
    const description = pick("error_description");
    return { kind: "error", reason: description ? `${errorCode}: ${description}` : errorCode };
  }

  // ── Email links (https) ────────────────────────────────────────────────
  if (isHttps) {
    const tokenHash = pick("token_hash");
    const type = pick("type");
    if (tokenHash && type) {
      return { kind: "email-token", tokenHash, type, next: pick("next") };
    }
    // Any other https link is ordinary web content, not an auth callback.
    return { kind: "ignored" };
  }

  // ── OAuth return (custom scheme) ───────────────────────────────────────
  // `new URL` puts the first segment of a custom-scheme URL in `host`, so
  // "app://auth/callback" is host=auth, pathname=/callback.
  const path = `${url.host}${url.pathname}`.replace(/\/+$/, "");
  if (path !== "auth/callback") return { kind: "ignored" };

  const code = pick("code");
  if (!code) {
    // Our own callback route with no code and no error is malformed — say so
    // rather than leaving the user on a spinner.
    return { kind: "error", reason: "callback did not include an authorization code" };
  }

  return { kind: "oauth-code", code };
}
