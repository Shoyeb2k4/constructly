import { describe, it, expect } from "vitest";
import { parseAuthCallback, OAUTH_CALLBACK_URL, MOBILE_URL_SCHEME } from "./auth-callback";

/**
 * Deep-link parsing is the app's only entry point for credentials arriving from
 * outside, so it is tested for what it must REFUSE as much as what it accepts.
 */
describe("OAuth callback", () => {
  it("extracts the authorization code from our callback URL", () => {
    const result = parseAuthCallback(`${OAUTH_CALLBACK_URL}?code=abc123`);
    expect(result).toEqual({ kind: "oauth-code", code: "abc123" });
  });

  it("accepts the scheme case-insensitively (iOS may normalise it)", () => {
    const result = parseAuthCallback(`${MOBILE_URL_SCHEME.toUpperCase()}://auth/callback?code=x`);
    expect(result.kind).toBe("oauth-code");
  });

  it("tolerates a trailing slash on the callback path", () => {
    expect(parseAuthCallback(`${OAUTH_CALLBACK_URL}/?code=x`).kind).toBe("oauth-code");
  });

  it("treats our own callback with no code as an error, not silence", () => {
    // Leaving the user on a spinner would be worse than saying it failed.
    const result = parseAuthCallback(OAUTH_CALLBACK_URL);
    expect(result.kind).toBe("error");
  });

  it("surfaces a provider error from the query string", () => {
    const result = parseAuthCallback(
      `${OAUTH_CALLBACK_URL}?error=access_denied&error_description=User%20cancelled`,
    );
    expect(result).toMatchObject({ kind: "error" });
    expect((result as { reason: string }).reason).toContain("access_denied");
    expect((result as { reason: string }).reason).toContain("User cancelled");
  });

  it("surfaces a provider error delivered in the URL fragment", () => {
    // Some Supabase/provider error responses use the fragment rather than query.
    const result = parseAuthCallback(`${OAUTH_CALLBACK_URL}#error=server_error`);
    expect(result).toMatchObject({ kind: "error" });
  });

  it("prefers reporting an error over an accompanying code", () => {
    const result = parseAuthCallback(`${OAUTH_CALLBACK_URL}?code=x&error=access_denied`);
    expect(result.kind).toBe("error");
  });
});

describe("links that must be ignored", () => {
  it("ignores a different path on our own scheme", () => {
    expect(parseAuthCallback(`${MOBILE_URL_SCHEME}://projects/123`).kind).toBe("ignored");
  });

  it("ignores an entirely unrelated scheme", () => {
    expect(parseAuthCallback("someotherapp://auth/callback?code=x").kind).toBe("ignored");
  });

  it("ignores ordinary https content", () => {
    expect(parseAuthCallback("https://constructly.co.in/projects").kind).toBe("ignored");
  });

  it("ignores unparseable input rather than throwing", () => {
    expect(parseAuthCallback("not a url").kind).toBe("ignored");
    expect(parseAuthCallback("").kind).toBe("ignored");
  });
});

describe("email links (password reset / confirmation)", () => {
  it("recognises a recovery link by token hash, not by PKCE code", () => {
    // Email links must stay cross-device, which is why they carry a token hash:
    // a PKCE code would only be redeemable on the device that started the flow.
    const result = parseAuthCallback(
      "https://app.example.test/auth/confirm?token_hash=hash123&type=recovery&next=/reset-password",
    );
    expect(result).toEqual({
      kind: "email-token",
      tokenHash: "hash123",
      type: "recovery",
      next: "/reset-password",
    });
  });

  it("requires both token_hash and type", () => {
    expect(parseAuthCallback("https://app.example.test/auth/confirm?token_hash=h").kind).toBe(
      "ignored",
    );
    expect(parseAuthCallback("https://app.example.test/auth/confirm?type=recovery").kind).toBe(
      "ignored",
    );
  });

  it("surfaces an expired-link error from an email link", () => {
    const result = parseAuthCallback(
      "https://app.example.test/auth/confirm?error=otp_expired&error_description=Token%20has%20expired",
    );
    expect(result.kind).toBe("error");
  });
});

describe("configuration coupling", () => {
  it("derives the callback URL from the bundle identifier", () => {
    // The scheme must match CFBundleURLTypes in Info.plist; deriving it here
    // keeps one source of truth on the JS side.
    expect(OAUTH_CALLBACK_URL).toBe(`${MOBILE_URL_SCHEME}://auth/callback`);
    expect(MOBILE_URL_SCHEME).toBe("in.co.constructly.app");
  });
});
