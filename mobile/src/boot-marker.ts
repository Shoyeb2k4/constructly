/**
 * Machine-checkable proof that the web layer actually ran inside the WebView.
 *
 * Capacitor forwards `console.log` from the WebView into the native os_log
 * stream, so these lines show up in `xcrun simctl spawn <udid> log show`. CI
 * asserts on them (`scripts/simulator-check.sh`), which closes the gap that a
 * screenshot alone leaves open:
 *
 *   - a non-blank screenshot proves *something* painted
 *   - these markers prove it was OUR app, which origin it was served from, and
 *     which screen it settled on
 *
 * Deliberately in `mobile/` only: nothing in `src/` (the production web app)
 * logs anything new because of this.
 */

const PREFIX = "[constructly-boot]";

/** Logged as soon as React has mounted. `origin` is the load-bearing part: it
 *  must be `capacitor://localhost`, proving assets were served by Capacitor's
 *  scheme handler and not, say, a file:// or http:// fallback. */
export function markMounted(): void {
  console.log(
    `${PREFIX} react-mounted origin=${window.location.origin} href=${window.location.href}`,
  );
}

/** Logged once the session gate resolves, naming the screen the user is
 *  actually looking at. This is what turns "the process is alive" into
 *  "the expected screen rendered". */
export function markScreen(screen: string, extra: Record<string, string | boolean> = {}): void {
  const details = Object.entries(extra)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(`${PREFIX} screen=${screen}${details ? ` ${details}` : ""}`);
}
