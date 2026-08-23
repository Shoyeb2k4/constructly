/**
 * `next/link` shim for the native client.
 *
 * Vite aliases `next/link` here so the ~30 components that render `<Link href>`
 * work unchanged. Renders a real react-router `<Link>`, which keeps navigation
 * client-side (no page load — there is no server to load from).
 *
 * `ref` is forwarded because several call sites wrap this in Radix `asChild`
 * slots, which need the underlying anchor.
 */
import * as React from "react";
import { Link as RouterLink } from "react-router";

type NextLinkProps = Omit<React.ComponentPropsWithoutRef<"a">, "href"> & {
  href: string;
  /** Accepted and ignored — a bundled SPA has nothing to prefetch. */
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
};

const Link = React.forwardRef<HTMLAnchorElement, NextLinkProps>(function Link(
  { href, prefetch, replace, scroll, children, ...rest },
  ref,
) {
  // Accepted for source compatibility with next/link, then deliberately
  // dropped: a bundled SPA has nothing to prefetch, and react-router owns
  // scroll restoration. Destructured out so they never reach the DOM.
  void prefetch;
  void scroll;

  // Absolute URLs (mailto:, tel:, https://…) must leave the router alone; on
  // iOS these are handed to the system browser by the WebView.
  const isExternal = /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
  if (isExternal) {
    return (
      <a ref={ref} href={href} {...rest}>
        {children}
      </a>
    );
  }

  return (
    <RouterLink ref={ref} to={href} replace={replace} {...rest}>
      {children}
    </RouterLink>
  );
});

export default Link;
