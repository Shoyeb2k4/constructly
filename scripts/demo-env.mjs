/**
 * The one place demo-mode environment is defined. `dev:demo`, `build:demo` and
 * `start:demo` all go through here so the three can never drift apart — the
 * split-brain they guard against is silent, and costs a debugging pass every
 * time it recurs.
 *
 * WHY EVERY VARIABLE MATTERS
 *
 * `CONSTRUCTLY_DEMO` is server-only: Next never inlines an unprefixed variable
 * into the client bundle. With it alone the SERVER renders the demo company
 * while the BROWSER still resolves `isDemoMode` to false and calls real server
 * actions against the real database. That looks like working demo mode right up
 * until the first mutation.
 *
 * `NEXT_PUBLIC_CONSTRUCTLY_DEMO` is what makes the client agree — and it is
 * inlined at BUILD time, not read at startup, which is why a demo preview must
 * be BUILT with `build:demo`. Setting it only when starting leaves demo off in
 * the browser.
 *
 * `NEXT_DIST_DIR` keeps demo output out of `.next`. Without it `build:demo`
 * silently overwrites the ordinary production build, so a later `npm start`
 * serves a demo bundle. It feeds the env-gated `distDir` in next.config.ts.
 *
 * `PORT` keeps the demo server off 3000. The separate build directory exists so
 * a demo preview can run ALONGSIDE the ordinary dev server; sharing a port
 * defeated that, and whichever started second died on bind.
 *
 * None of these belong in a real production environment.
 */

/** Build directory for every demo artifact. Ignored by git. */
export const DEMO_DIST_DIR = ".next-demo";

/** Default demo port. `PORT` still wins if the caller sets one. */
export const DEMO_PORT = "3100";

/** Demo environment layered over `process.env`, with caller overrides kept. */
export function demoEnv(extra = {}) {
  return {
    ...process.env,
    CONSTRUCTLY_DEMO: "1",
    NEXT_PUBLIC_CONSTRUCTLY_DEMO: "1",
    NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? DEMO_DIST_DIR,
    PORT: process.env.PORT ?? DEMO_PORT,
    ...extra,
  };
}

/** Absolute path to the Next CLI, normalised for Windows drive letters. */
export function nextBin(importMetaUrl) {
  return new URL("../node_modules/next/dist/bin/next", importMetaUrl).pathname.replace(
    /^\/([A-Za-z]:)/,
    "$1",
  );
}
