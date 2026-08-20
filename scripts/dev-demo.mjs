/**
 * Start the DEV server in DEMO mode — the canonical command for local review.
 *
 *   npm run dev:demo      → http://localhost:3100
 *
 * Runs alongside an ordinary `npm run dev` on :3000: separate port, separate
 * build directory. Environment lives in demo-env.mjs; there are no manual
 * prefixes to remember and nothing to unset afterwards.
 */
import { spawn } from "node:child_process";
import { demoEnv, nextBin, DEMO_PORT, DEMO_DIST_DIR } from "./demo-env.mjs";

const env = demoEnv();
console.log(
  `\n  Constructly DEMO (dev) → http://localhost:${env.PORT ?? DEMO_PORT}  [distDir ${env.NEXT_DIST_DIR ?? DEMO_DIST_DIR}]\n`,
);

const child = spawn(process.execPath, [nextBin(import.meta.url), "dev"], {
  stdio: "inherit",
  env,
});

child.on("exit", (code) => process.exit(code ?? 0));
