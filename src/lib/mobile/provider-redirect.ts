/**
 * Validation of the redirect Supabase hands to the OAuth provider.
 *
 * Deliberately free of relative imports: the provider-verification script loads
 * this module directly under Node's TypeScript support, which — unlike a
 * bundler — cannot resolve extensionless relative specifiers. Keeping it
 * self-contained means CI validates the same code the app is tested against,
 * instead of a reimplementation that could drift.
 *
 * The assertion here is the inverse of the one on our own request: at THIS hop
 * the redirect target must be SUPABASE's callback, never the app's custom
 * scheme. Supabase is the broker — it holds the Google client secret and
 * performs the Google code exchange — so a `redirect_uri` pointing at
 * `in.co.constructly.app://` would mean the Google credential had been
 * misconfigured as a native/iOS client.
 */
export interface ProviderRedirectFacts {
  valid: boolean;
  problems: string[];
  host: string;
}

export function describeProviderRedirect(
  locationHeader: string,
  supabaseUrl: string,
): ProviderRedirectFacts {
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

  // Absent client_id means the provider is enabled but not actually configured.
  if (!url.searchParams.get("client_id")) {
    problems.push("no client_id — Google provider is not configured");
  }

  return { valid: problems.length === 0, problems, host: url.host };
}
