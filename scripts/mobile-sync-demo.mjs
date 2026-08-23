/**
 * Build + verify + sync the native app in DEMO mode.
 *
 * `npm run mobile:sync` deliberately refuses to build without
 * NEXT_PUBLIC_MOBILE_API_BASE, so a real device build can never ship pointing at
 * nothing. This is the offline counterpart: it produces a self-contained bundle
 * backed by demo fixtures, which is what makes the whole Capacitor pipeline
 * verifiable from Windows with no backend and no Supabase credentials.
 *
 * Not for release — the artifact it syncs contains demo data, not a real client.
 */
import { spawnSync } from "node:child_process";

const env = { ...process.env, NEXT_PUBLIC_CONSTRUCTLY_DEMO: "1" };
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const steps = [
  [npm, ["run", "mobile:build"]],
  [npm, ["run", "mobile:verify"]],
  [process.platform === "win32" ? "npx.cmd" : "npx", ["cap", "sync", "ios"]],
];

for (const [cmd, args] of steps) {
  const res = spawnSync(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (res.status !== 0) process.exit(res.status ?? 1);
}
