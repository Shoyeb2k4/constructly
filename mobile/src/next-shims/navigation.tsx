/**
 * `next/navigation` shim for the native client.
 *
 * Vite aliases `next/navigation` to this module, so the ~38 existing components
 * that import `useRouter` / `usePathname` / `useSearchParams` compile and run
 * unchanged inside Capacitor. Nothing in `src/` is edited for mobile's benefit.
 *
 * DESIGN RULE (deliberate): this shim is strict. Where a Next behaviour has a
 * faithful client-side equivalent it is implemented and documented; where it
 * does not, the shim THROWS rather than quietly doing nothing, so a semantic
 * gap surfaces during development instead of becoming a silent bug on a phone.
 */
import * as React from "react";
import {
  useNavigate,
  useLocation,
  useParams as useRouterParams,
  useSearchParams as useRouterSearchParams,
} from "react-router";
import { useQueryClient } from "@tanstack/react-query";

export interface AppRouterInstance {
  push(href: string): void;
  replace(href: string): void;
  back(): void;
  forward(): void;
  refresh(): void;
  prefetch(href: string): void;
}

export function useRouter(): AppRouterInstance {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return React.useMemo<AppRouterInstance>(
    () => ({
      push: (href) => void navigate(href),
      replace: (href) => void navigate(href, { replace: true }),
      back: () => void navigate(-1),
      forward: () => void navigate(1),

      /**
       * On the web this re-runs the server render to pick up fresh data. The
       * native client has no server render — every screen's data comes from
       * React Query — so the faithful equivalent is to invalidate the caches.
       * This is a documented mapping, not a no-op.
       */
      refresh: () => void queryClient.invalidateQueries(),

      /**
       * Next prefetches server-rendered route payloads. A bundled SPA has no
       * route payloads to fetch: the JS is already on the device and data is
       * fetched by React Query on mount. Nothing to do, and nothing is lost.
       */
      prefetch: () => {},
    }),
    [navigate, queryClient],
  );
}

export function usePathname(): string {
  return useLocation().pathname;
}

export function useSearchParams(): URLSearchParams {
  const [params] = useRouterSearchParams();
  return params;
}

export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return useRouterParams() as T;
}

/**
 * `redirect()` works by throwing during a SERVER render. The native client
 * mounts no server components, so reaching this is always a porting mistake —
 * the component should use `useRouter().replace()` instead. Fail loudly.
 */
export function redirect(url: string): never {
  throw new Error(
    `[mobile] next/navigation redirect("${url}") is not supported in the native client. ` +
      `Use useRouter().replace() from a client component instead.`,
  );
}

/** Server-only in Next; see `redirect` above. */
export function notFound(): never {
  throw new Error(
    "[mobile] next/navigation notFound() is not supported in the native client. " +
      "Render a not-found state from the component instead.",
  );
}
