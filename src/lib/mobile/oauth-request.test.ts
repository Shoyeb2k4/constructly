import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  googleOAuthRequest,
  describeAuthorizationUrl,
  describeProviderRedirect,
} from "./oauth-request";
import { OAUTH_CALLBACK_URL } from "./auth-callback";

const SUPABASE = "https://projectref.supabase.co";

describe("the OAuth request Constructly generates", () => {
  it("always targets the registered custom scheme", () => {
    expect(googleOAuthRequest().options.redirectTo).toBe(OAUTH_CALLBACK_URL);
    expect(OAUTH_CALLBACK_URL.startsWith("in.co.constructly.app://")).toBe(true);
  });

  it("cannot be redirected somewhere else by caller input", () => {
    // Taking no parameters is the guarantee: no deep link, query param or
    // pushed config can point an authorization response at another target.
    expect(googleOAuthRequest.length).toBe(0);
  });

  it("keeps the authorization page out of the WebView", () => {
    // Google blocks embedded WebViews for OAuth, and the user should see a real
    // URL bar before typing a password.
    expect(googleOAuthRequest().options.skipBrowserRedirect).toBe(true);
  });
});

describe("authorization URL validation", () => {
  const good =
    `${SUPABASE}/auth/v1/authorize?provider=google` +
    `&redirect_to=${encodeURIComponent(OAUTH_CALLBACK_URL)}` +
    `&code_challenge=abc&code_challenge_method=s256`;

  it("accepts a correct PKCE request to our callback", () => {
    const facts = describeAuthorizationUrl(good);
    expect(facts.valid).toBe(true);
    expect(facts.usesPkce).toBe(true);
    expect(facts.codeChallengeMethod).toBe("s256");
    expect(facts.redirectTo).toBe(OAUTH_CALLBACK_URL);
  });

  it("rejects a request with no PKCE challenge", () => {
    const facts = describeAuthorizationUrl(
      `${SUPABASE}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(OAUTH_CALLBACK_URL)}`,
    );
    expect(facts.valid).toBe(false);
    expect(facts.usesPkce).toBe(false);
    expect(facts.problems.join(" ")).toMatch(/not PKCE/i);
  });

  it("rejects the weak 'plain' challenge method", () => {
    // `plain` sends the verifier itself, defeating the point of PKCE.
    const facts = describeAuthorizationUrl(good.replace("s256", "plain"));
    expect(facts.valid).toBe(false);
    expect(facts.problems.join(" ")).toMatch(/weak/i);
  });

  it("rejects a redirect target that is not our callback", () => {
    const facts = describeAuthorizationUrl(
      good.replace(encodeURIComponent(OAUTH_CALLBACK_URL), encodeURIComponent("https://evil.test/x")),
    );
    expect(facts.valid).toBe(false);
    expect(facts.problems.join(" ")).toMatch(/redirect_to/);
  });

  it("flags a confidential parameter in the request", () => {
    const facts = describeAuthorizationUrl(`${good}&client_secret=leaked`);
    expect(facts.hasForbiddenParams).toBe(true);
    expect(facts.valid).toBe(false);
  });

  it("never echoes the challenge, state or client id in its findings", () => {
    const facts = describeAuthorizationUrl(`${good}&state=SENSITIVE_STATE&client_id=SENSITIVE_ID`);
    const report = JSON.stringify(facts);
    expect(report).not.toContain("SENSITIVE_STATE");
    expect(report).not.toContain("SENSITIVE_ID");
    expect(report).not.toContain("abc"); // the code_challenge value
  });

  it("fails safely on a malformed provider response", () => {
    expect(describeAuthorizationUrl("://nonsense").valid).toBe(false);
    expect(describeAuthorizationUrl("").valid).toBe(false);
  });
});

describe("provider redirect architecture", () => {
  const googleUrl =
    "https://accounts.google.com/o/oauth2/v2/auth?client_id=x.apps.googleusercontent.com" +
    `&redirect_uri=${encodeURIComponent(`${SUPABASE}/auth/v1/callback`)}`;

  it("accepts Google redirecting back to the Supabase callback", () => {
    // Supabase is the broker: it holds the client secret and does the Google
    // code exchange, so a Web-type Google client is the correct credential.
    expect(describeProviderRedirect(googleUrl, SUPABASE).valid).toBe(true);
  });

  it("rejects Google being pointed straight at the app's custom scheme", () => {
    // That would mean an iOS-type Google client was configured — the wrong
    // architecture for a Supabase-brokered flow.
    const wrong = googleUrl.replace(
      encodeURIComponent(`${SUPABASE}/auth/v1/callback`),
      encodeURIComponent(OAUTH_CALLBACK_URL),
    );
    expect(describeProviderRedirect(wrong, SUPABASE).valid).toBe(false);
  });

  it("rejects a redirect to a host that is not Google", () => {
    expect(describeProviderRedirect(googleUrl.replace("accounts.google.com", "evil.test"), SUPABASE).valid).toBe(false);
  });

  it("reports an unconfigured provider (no client_id)", () => {
    const noClient = googleUrl.replace(/client_id=[^&]*&/, "");
    expect(describeProviderRedirect(noClient, SUPABASE).problems.join(" ")).toMatch(/client_id/);
  });

  it("fails safely on a malformed location header", () => {
    expect(describeProviderRedirect("", SUPABASE).valid).toBe(false);
  });
});

describe("web OAuth is left alone", () => {
  it("the web sign-in page still derives its redirect from the browser origin", () => {
    // Phase 4/5 must not have leaked the mobile custom scheme into the web flow.
    const source = readFileSync(
      path.resolve(import.meta.dirname, "../../app/(auth)/sign-in/page.tsx"),
      "utf8",
    );
    expect(source).toContain("window.location.origin");
    expect(source).toContain("/auth/callback");
    expect(source).not.toContain("in.co.constructly.app");
  });
});
