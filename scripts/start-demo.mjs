/**
 * Serve the DEMO build — production-style preview, step 2 of 2.
 *
 *   npm run build:demo && npm run start:demo   → http://localhost:3100
 *
 * Production mode is the more trustworthy surface for a visual review: no HMR
 * socket and no Fast Refresh, so a stalled dev websocket cannot leave a subtree
 * unhydrated. Reads `.next-demo`, so it serves the demo build and never the
 * deployable one — and fails loudly rather than silently serving a stale or
 * non-demo bundle if that build is missing.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { demoEnv, nextBin, DEMO_DIST_DIR, DEMO_PORT } from "./demo-env.mjs";

const env = demoEnv();
const distDir = env.NEXT_DIST_DIR ?? DEMO_DIST_DIR;

if (!existsSync(new URL(`../${distDir}/BUILD_ID`, import.meta.url))) {
  console.error(
    `\n  No demo build in ${distDir}/.\n  Run:  npm run build:demo\n`,
  );
  process.exit(1);
}

console.log(
  `\n  Constructly DEMO (production) → http://localhost:${env.PORT ?? DEMO_PORT}  [distDir ${distDir}]\n`,
);

const child = spawn(process.execPath, [nextBin(import.meta.url), "start"], {
  stdio: "inherit",
  env,
});

child.on("exit", (code) => process.exit(code ?? 0));
