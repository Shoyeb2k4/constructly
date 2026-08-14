/**
 * Build the app in DEMO mode.
 *
 * Both flags matter. `CONSTRUCTLY_DEMO` is server-only — Next never inlines an
 * unprefixed variable into the client bundle — so with it alone the server
 * renders the demo company while the browser still calls real server actions.
 * `NEXT_PUBLIC_CONSTRUCTLY_DEMO` is what makes the client agree, which is why
 * demo mode previously appeared to work and then hung on real data.
 *
 * NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time, not
 * read at startup — so a demo preview served by `next start` must be built this
 * way. Setting the flag only when starting leaves demo off in the browser and
 * the app silently calls real server actions.
 *
 * Re-run the ordinary `npm run build` before deploying: this artifact is demo.
 */
import { spawn } from "node:child_process";

const child = spawn(
  process.execPath,
  [new URL("../node_modules/next/dist/bin/next", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "build"],
  {
    stdio: "inherit",
    env: { ...process.env, CONSTRUCTLY_DEMO: "1", NEXT_PUBLIC_CONSTRUCTLY_DEMO: "1" },
  },
);

child.on("exit", (code) => process.exit(code ?? 0));
