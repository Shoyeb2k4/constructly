/**
 * Serve the PRODUCTION build in DEMO mode.
 *
 * Both flags matter. `CONSTRUCTLY_DEMO` is server-only — Next never inlines an
 * unprefixed variable into the client bundle — so with it alone the server
 * renders the demo company while the browser still calls real server actions.
 * `NEXT_PUBLIC_CONSTRUCTLY_DEMO` is what makes the client agree, which is why
 * demo mode previously appeared to work and then hung on real data.
 *
 * Production mode is the reliable surface for a visual review: no HMR socket,
 * no Fast Refresh, so a stalled dev-server websocket cannot leave a client
 * subtree unhydrated. Run `npm run build` first. Never set these in production.
 */
import { spawn } from "node:child_process";

const child = spawn(
  process.execPath,
  [new URL("../node_modules/next/dist/bin/next", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "start"],
  {
    stdio: "inherit",
    env: { ...process.env, CONSTRUCTLY_DEMO: "1", NEXT_PUBLIC_CONSTRUCTLY_DEMO: "1" },
  },
);

child.on("exit", (code) => process.exit(code ?? 0));
