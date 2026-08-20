/**
 * Build the app in DEMO mode — production-style preview, step 1 of 2.
 *
 *   npm run build:demo && npm run start:demo   → http://localhost:3100
 *
 * Writes to `.next-demo`, NOT `.next`: this artifact has demo mode compiled
 * into the client bundle and must never be mistaken for a deployable build.
 * The ordinary `npm run build` output is left untouched, so the two can coexist
 * and neither needs deleting between runs.
 */
import { spawn } from "node:child_process";
import { demoEnv, nextBin, DEMO_DIST_DIR } from "./demo-env.mjs";

const env = demoEnv();
console.log(`\n  Constructly DEMO build → ${env.NEXT_DIST_DIR ?? DEMO_DIST_DIR} (not deployable)\n`);

const child = spawn(process.execPath, [nextBin(import.meta.url), "build"], {
  stdio: "inherit",
  env,
});

child.on("exit", (code) => process.exit(code ?? 0));
