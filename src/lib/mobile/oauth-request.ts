import { OAUTH_CALLBACK_URL } from "./auth-callback";

/**
 * The OAuth request contract, kept pure and away from Capacitor so it can be
 * unit-tested and reused by the provider-verification script.
 *
 * THE REDIRECT CHAIN (why the callback here is not what Google is told):
 *
 *   Constructly iOS
 *     → https://<ref>.supabase.co/auth/v1/authorize?provider=google
 *       &redirect_to=in.co.constructly.app://auth/callback
 *       &code_challenge=…            ← OUR PKCE challenge
 *     → accounts.google.com/o/oauth2/…
 *       &redirect_uri=https://<ref>.supabase.co/auth/v1/callback   ← Supabase's
 *     → Supabase exchanges Google's code using Supabase's own client secret
 *     → in.co.constructly.app://auth/callback?code=…               ← back to us
 *     → app exchanges that code with ITS verifier
 *
 * Supabase is the OAuth broker. Google therefore never redirects to the custom
 * scheme and must NOT have it registered: its only authorized redirect URI is
 * the Supabase callback, which is why a Web-type Google client is correct and
 * an iOS-type client would be wrong here.
 */

/** Google client secrets belong to Supabase's server side, never to a public
 *  client. Anything resembling one in a request we generate is a defect. */
const FORBIDDEN_REQUEST_PARAMS = ["client_secret", "secret", "code_verifier"];

/**
 * Options for `signInWithOAuth`. Takes no caller input on purpose: the redirect
 * target is fixed at build time so no runtime value — a deep link, a query
 * param, a pushed config — can redirect an authorization response somewhere
 * else.
 */
export function googleOAuthRequest() {
  return {
    provider: "google" as const,
    options: {
      redirectTo: OAUTH_CALLBACK_URL,
      // The authorization URL must open in the system browser: Google blocks
      // embedded WebViews for OAuth, and the user should see a real URL bar.
      skipBrowserRedirect: true,
    },
  };
}

export interface AuthorizationUrlFacts {
  valid: boolean;
  problems: string[];
  host: string;
  /** Present and correct means PKCE is in play. */
  usesPkce: boolean;
  codeChallengeMethod: string | null;
  /** Where Supabase is told to send the user back to. */
  redirectTo: string | null;
  /** Whether any confidential parameter leaked into the request. */
  hasForbiddenParams: boolean;
}

/**
 * Describe an authorization URL structurally, WITHOUT echoing any value that
 * could be sensitive. Returns facts and problems, never the challenge, the
 * state token or the client id — a report is not a place for those.
 */
export function describeAuthorizationUrl(rawUrl: string): AuthorizationUrlFacts {
  const problems: string[] = [];
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      valid: false,
      problems: ["not a valid URL"],
      host: "",
      usesPkce: false,
      codeChallengeMethod: null,
      redirectTo: null,
      hasForbiddenParams: false,
    };
  }

  const params = url.searchParams;
  const codeChallenge = params.get("code_challenge");
  const codeChallengeMethod = params.get("code_challenge_method");
  const redirectTo = params.get("redirect_to");

  if (url.protocol !== "https:") problems.push("authorization URL is not https");
  if (!codeChallenge) problems.push("no PKCE code_challenge — flow is not PKCE");
  if (codeChallengeMethod && codeChallengeMethod.toLowerCase() !== "s256") {
    // "plain" would make the challenge useless against interception.
    problems.push(`weak code_challenge_method: ${codeChallengeMethod}`);
  }
  if (redirectTo !== OAUTH_CALLBACK_URL) {
    problems.push(`redirect_to is "${redirectTo}", expected "${OAUTH_CALLBACK_URL}"`);
  }

  const hasForbiddenParams = FORBIDDEN_REQUEST_PARAMS.some((p) => params.has(p));
  if (hasForbiddenParams) problems.push("request contains a confidential parameter");

  return {
    valid: problems.length === 0,
    problems,
    host: url.host,
    usesPkce: Boolean(codeChallenge),
    codeChallengeMethod: codeChallengeMethod?.toLowerCase() ?? null,
    redirectTo,
    hasForbiddenParams,
  };
}

/**
 * Check the URL Supabase hands to Google. Here the redirect target must be
 * SUPABASE's callback, not ours — if our custom scheme ever appeared in
 * Google's `redirect_uri`, the provider was misconfigured as a native client.
 */
export function describeProviderRedirect(
  locationHeader: string,
  supabaseUrl: string,
): { valid: boolean; problems: string[]; host: string } {
  const problems: string[] = [];
  let url: URL;
  try {
    url = new URL(locationHeader);
  } catch {
    return { valid: false, problems: ["provider redirect is not a valid URL"], host: "" };
  }

  if (!/(^|\.)google\.com$/.test(url.host)) {
    problems.push(`provider host is ${url.host}, expected accounts.google.com`);
  }

  const redirectUri = url.searchParams.get("redirect_uri");
  const expected = `${supabaseUrl.replace(/\/$/, "")}/auth/v1/callback`;
  if (redirectUri !== expected) {
    problems.push(`Google redirect_uri is "${redirectUri}", expected the Supabase callback`);
  }
  if (!url.searchParams.get("client_id")) {
    problems.push("no client_id — Google provider is not configured");
  }

  return { valid: problems.length === 0, problems, host: url.host };
}
