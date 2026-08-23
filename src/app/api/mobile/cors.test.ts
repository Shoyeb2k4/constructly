import { describe, it, expect } from "vitest";
import { isAllowedMobileOrigin, mobileCorsHeaders, mobilePreflightHeaders } from "./cors";

/**
 * Regression cover for the defect that made the native app unusable: the RPC
 * route answered no preflight and returned no CORS headers, so every call from
 * the Capacitor WebView — a genuinely cross-origin client — was discarded by
 * the browser before the app ever saw it.
 *
 * These tests pin both halves: the native origins must work, and the allowlist
 * must not quietly widen into "any origin".
 */

const IOS = "capacitor://localhost";
const ANDROID = "https://localhost";

describe("mobile CORS allowlist", () => {
  it("permits the origins the native shells actually use", () => {
    // iOS: `server.iosScheme: "capacitor"`. Android: `androidScheme: "https"`.
    expect(isAllowedMobileOrigin(IOS)).toBe(true);
    expect(isAllowedMobileOrigin(ANDROID)).toBe(true);
  });

  it("rejects everything else, including near-misses", () => {
    for (const origin of [
      "https://evil.example",
      // Not the deployed site — the web app is same-origin and needs no CORS.
      "https://constructly.co.in",
      // Scheme, port and subdomain variations must not slip through.
      "http://localhost",
      "https://localhost:8443",
      "https://localhost.evil.example",
      "capacitor://localhost.evil.example",
      "null",
      "*",
    ]) {
      expect(isAllowedMobileOrigin(origin), origin).toBe(false);
    }
  });

  it("treats a missing Origin as not-CORS rather than as permitted", () => {
    expect(isAllowedMobileOrigin(null)).toBe(false);
    expect(mobileCorsHeaders(null)).toEqual({});
  });
});

describe("mobile CORS headers", () => {
  it("echoes only the allowlisted origin, never a wildcard", () => {
    const headers = mobileCorsHeaders(ANDROID);
    expect(headers["Access-Control-Allow-Origin"]).toBe(ANDROID);
    expect(headers["Access-Control-Allow-Origin"]).not.toBe("*");
  });

  it("varies on Origin so a shared cache cannot cross-serve the header", () => {
    expect(mobileCorsHeaders(IOS)["Vary"]).toBe("Origin");
  });

  it("emits nothing at all for a disallowed origin", () => {
    expect(mobileCorsHeaders("https://evil.example")).toEqual({});
    expect(mobilePreflightHeaders("https://evil.example")).toEqual({});
  });

  it("never allows credentials — this route is bearer-only by design", () => {
    // Allowing credentials would re-open the cookie/CSRF surface that using a
    // bearer token exists to avoid.
    for (const headers of [mobileCorsHeaders(ANDROID), mobilePreflightHeaders(ANDROID)]) {
      expect(headers["Access-Control-Allow-Credentials"]).toBeUndefined();
    }
  });

  it("preflight permits exactly the method and headers the RPC client sends", () => {
    const headers = mobilePreflightHeaders(IOS);
    expect(headers["Access-Control-Allow-Methods"]).toBe("POST, OPTIONS");
    // `src/lib/mobile/rpc.ts` sends both of these on every call.
    expect(headers["Access-Control-Allow-Headers"]).toContain("Authorization");
    expect(headers["Access-Control-Allow-Headers"]).toContain("Content-Type");
    expect(Number(headers["Access-Control-Max-Age"])).toBeGreaterThan(0);
  });

  it("does not permit methods the route does not implement", () => {
    const allowed = mobilePreflightHeaders(IOS)["Access-Control-Allow-Methods"];
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
      expect(allowed).not.toContain(method);
    }
  });
});
