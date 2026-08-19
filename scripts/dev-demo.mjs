/**
 * Start the dev server in DEMO mode.
 *
 * Both flags matter. `CONSTRUCTLY_DEMO` is server-only — Next never inlines an
 * unprefixed variable into the client bundle — so with it alone the server
 * renders the demo company while the browser still calls real server actions.
 * `NEXT_PUBLIC_CONSTRUCTLY_DEMO` is what makes the client agree, which is why
 * demo mode previously appeared to work and then hung on real data.
 *
 * A launcher rather than `cross-env` so demo previews need no extra dependency,
 * and rather than blanking the Supabase config, which breaks unrelated client
 * wiring. Never set these in a production environment.
 */
import { spawn } from "node:child_process";

const child = spawn(
  process.execPath,
  [new URL("../node_modules/next/dist/bin/next", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "dev"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      CONSTRUCTLY_DEMO: "1",
      NEXT_PUBLIC_CONSTRUCTLY_DEMO: "1",
      // Its own build directory, so a demo preview can run ALONGSIDE the normal
      // dev server instead of fighting it for Next's single-instance lock on
      // `.next` (which ends with one of them exiting on startup). Reads the
      // env-gated `distDir` in next.config.ts; `.next-demo/` is already ignored.
      NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? ".next-demo",
    },
  },
);

child.on("exit", (code) => process.exit(code ?? 0));
