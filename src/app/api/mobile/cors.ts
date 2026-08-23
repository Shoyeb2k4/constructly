/**
 * CORS for the mobile RPC boundary.
 *
 * WHY THIS EXISTS AT ALL — the native app is a real cross-origin client. The
 * bundle is served by the platform WebView from its own origin, never by Next:
 *
 *   iOS (WKWebView)      capacitor://localhost
 *   Android (WebView)    https://localhost      (server.androidScheme: "https")
 *
 * and it calls `https://constructly.co.in/api/mobile/…`. Because every RPC call
 * carries `Content-Type: application/json` AND an `Authorization` header, it is
 * never a "simple" request, so the WebView issues a preflight `OPTIONS` first.
 * Without an OPTIONS handler Next answers 405, the preflight fails, and *every*
 * screen in the native app dies on its first data fetch.
 *
 * WHY AN ALLOWLIST AND NOT `*` — `*` would work (bearer auth means there are no
 * cookies for a hostile page to ride on), but it would also invite any website
 * on the internet to use this endpoint as an open proxy for probing. Echoing a
 * fixed, closed set costs nothing and keeps the reachable surface honest.
 *
 * WHY NO `Access-Control-Allow-Credentials` — deliberately absent. This route
 * authenticates with a bearer token only. Allowing credentials would let a
 * browser attach cookies here, which is exactly the cookie/CSRF surface the
 * token design avoids.
 *
 * THE WEB APP IS UNAFFECTED. Server Actions are same-origin and never reach
 * this file.
 */

/**
 * Origins permitted to call the mobile RPC.
 *
 * Fixed at build time — no wildcard matching, no subdomain patterns, no reading
 * of a header to decide what to trust. Adding an entry is a reviewable diff.
 */
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  // iOS — WKWebView with `server.iosScheme: "capacitor"`.
  "capacitor://localhost",
  // Android — WebViewAssetLoader with `server.androidScheme: "https"`.
  "https://localhost",
  // `npm run mobile:dev` — the SPA in a desktop browser against a real backend.
  // Harmless in production: a page must already be served from this exact
  // origin, which means it is running on the developer's own machine.
  "http://localhost:5300",
]);

/** Preflight results may be cached for a day; the allowlist is static. */
const MAX_AGE_SECONDS = 86_400;

export function isAllowedMobileOrigin(origin: string | null): boolean {
  return origin !== null && ALLOWED_ORIGINS.has(origin);
}

/**
 * Headers to attach to a mobile RPC response.
 *
 * Returns `{}` for anything not on the allowlist — including a same-origin
 * request, which sends no `Origin` at all and needs no CORS header. Never
 * echoes an untrusted origin back.
 *
 * `Vary: Origin` is mandatory: without it a CDN can cache the response produced
 * for one origin and serve it to another.
 */
export function mobileCorsHeaders(origin: string | null): Record<string, string> {
  if (!isAllowedMobileOrigin(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin as string,
    "Vary": "Origin",
  };
}

/** Additional headers that only a preflight response needs. */
export function mobilePreflightHeaders(origin: string | null): Record<string, string> {
  const base = mobileCorsHeaders(origin);
  if (Object.keys(base).length === 0) return {};
  return {
    ...base,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": String(MAX_AGE_SECONDS),
  };
}
