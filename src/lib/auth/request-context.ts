import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { SessionUser } from "./types";

/**
 * Request-scoped session injection for NON-cookie callers.
 *
 * The web app authenticates with cookies: `getCurrentUser()` reads the
 * `@supabase/ssr` cookie store and every Server Action inherits that session
 * implicitly. The mobile app has no usable cookie jar — WKWebView serves the
 * bundle from `capacitor://localhost`, a different origin from the API — so it
 * authenticates with an `Authorization: Bearer <supabase access_token>` header
 * instead.
 *
 * Rather than fork every server action into a "web" and a "mobile" variant, the
 * mobile RPC route resolves the bearer token ONCE, then runs the very same
 * action inside this store. `getCurrentUser()` checks the store first and falls
 * through to the untouched cookie path when it is empty.
 *
 * On the web the store is ALWAYS empty — `runWithSession` is called from
 * exactly one place (`src/app/api/mobile/[feature]/[method]/route.ts`), so web
 * behaviour is unchanged. AsyncLocalStorage is per-async-context, so concurrent
 * requests on the same server cannot see each other's session.
 */
const sessionStore = new AsyncLocalStorage<SessionUser>();

/** Run `fn` with `user` as the resolved session for its entire async subtree. */
export function runWithSession<T>(user: SessionUser, fn: () => Promise<T>): Promise<T> {
  return sessionStore.run(user, fn);
}

/** The explicitly-injected session for this request, or undefined on the web. */
export function injectedSession(): SessionUser | undefined {
  return sessionStore.getStore();
}
