/**
 * Run the mobile SPA dev server in DEMO mode.
 *
 * Mirrors `scripts/dev-demo.mjs`: the Vite config inlines `NEXT_PUBLIC_*` at
 * build time from `process.env`, so the flag must be set on the process rather
 * than read from a file. With it set, `src/lib/env.ts` reports demo mode and
 * every feature's `data.ts` resolves to its demo repository — so the whole
 * native UI can be exercised on Windows with no backend running and no
 * Supabase credentials.
 *
 * A launcher rather than `cross-env` so this needs no extra dependency, and to
 * match the convention already used for the web demo scripts.
 */
import { spawn } from "node:child_process";

const child = spawn(
  process.execPath,
  [
    new URL("../node_modules/vite/bin/vite.js", import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      "$1",
    ),
    "--config",
    "mobile/vite.config.mts",
    "--port",
    "5300",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, NEXT_PUBLIC_CONSTRUCTLY_DEMO: "1" },
  },
);

child.on("exit", (code) => process.exit(code ?? 0));
