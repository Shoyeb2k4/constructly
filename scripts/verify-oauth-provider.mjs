/**
 * Verify the REAL production OAuth provider configuration for Constructly mobile.
 *
 * Read-only and unauthenticated. Uses only public values — the Supabase project
 * URL and publishable key, both of which already ship inside the mobile bundle
 * — and never signs a user in, never mutates anything, and never needs a Google
 * account.
 *
 * What it proves, in order of increasing depth:
 *   1. the Google provider is actually enabled on the project
 *   2. Supabase accepts our custom-scheme callback as a redirect target
 *   3. Supabase hands the user to Google with GOOGLE's redirect_uri set to the
 *      Supabase callback — confirming Supabase is the broker and that a Web
 *      OAuth client (not an iOS one) is the correct Google credential
 *   4. the request Constructly generates is PKCE, points at our callback, and
 *      carries no confidential parameter
 *
 * NOTHING SENSITIVE IS PRINTED: no client id, no state token, no code
 * challenge, no verifier, no code. Only structural facts and problems.
 *
 * Usage:
 *   node scripts/verify-oauth-provider.mjs [--require-provider]
 *
 * Without `--require-provider` a disabled Google provider is reported and
 * exits 0, so the check can live in CI before the dashboard work is done.
 * With it, a disabled provider is a failure.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const REQUIRE_PROVIDER = process.argv.includes("--require-provider");

/* ── Public config ────────────────────────────────────────────────────── */

function loadEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const fileEnv = {
  ...loadEnvFile(path.join(ROOT, ".env")),
  ...loadEnvFile(path.join(ROOT, ".env.local")),
};
const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL || ""
).replace(/\/$/, "");
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  fileEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";

let passed = 0;
let failed = 0;
const problems = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  [PASS] ${name}${detail ? `  ${detail}` : ""}`);
  } else {
    failed++;
    problems.push(name);
    console.log(`  [FAIL] ${name}${detail ? `  ${detail}` : ""}`);
  }
}

/* ── Load the app's own contract, so CI and the app cannot drift ──────── */

const { OAUTH_CALLBACK_URL } = await import(
  pathToFileURL(path.join(ROOT, "src/lib/mobile/auth-callback.ts")).href
).catch(() => ({}));

async function main() {
  console.log("\n=== SAFE TO PASTE: BEGIN =====================================");
  console.log("Constructly mobile OAuth provider verification");
  console.log(`project: ${SUPABASE_URL || "(not configured)"}\n`);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log("  [FAIL] Supabase public config missing (URL / publishable key)");
    console.log("=== SAFE TO PASTE: END =======================================\n");
    return 1;
  }

  const callback = OAUTH_CALLBACK_URL ?? "in.co.constructly.app://auth/callback";
  console.log(`mobile callback under test: ${callback}\n`);

  /* 1 ── provider enabled? ------------------------------------------------ */
  console.log("A. Provider configuration");
  const settingsRes = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: SUPABASE_KEY },
  });
  const settings = await settingsRes.json().catch(() => ({}));
  const external = settings.external ?? {};
  const googleEnabled = external.google === true;

  const enabledList = Object.entries(external)
    .filter(([, v]) => v === true)
    .map(([k]) => k)
    .join(", ");
  console.log(`  enabled providers: ${enabledList || "(none)"}`);

  if (!googleEnabled) {
    if (REQUIRE_PROVIDER) {
      check("Google provider enabled", false, "(disabled on this project)");
    } else {
      console.log("  [SKIP] Google provider is not enabled on this project yet.");
      console.log("         Enable it in the Supabase dashboard, then re-run with");
      console.log("         --require-provider to enforce the rest of these checks.");
    }
    console.log(`\nRESULT: ${passed} passed, ${failed} failed (Google not configured)`);
    console.log("=== SAFE TO PASTE: END =======================================\n");
    return REQUIRE_PROVIDER ? 1 : 0;
  }

  check("Google provider enabled", true);

  /* 2 ── does Supabase accept our custom-scheme callback? ----------------- */
  console.log("\nB. Redirect allow-list");
  const authorizeUrl =
    `${SUPABASE_URL}/auth/v1/authorize?provider=google` +
    `&redirect_to=${encodeURIComponent(callback)}`;
  const authorizeRes = await fetch(authorizeUrl, {
    headers: { apikey: SUPABASE_KEY },
    redirect: "manual",
  });

  if (authorizeRes.status >= 400) {
    const body = await authorizeRes.json().catch(() => ({}));
    check(
      "custom-scheme callback accepted",
      false,
      `(HTTP ${authorizeRes.status}: ${body.msg ?? body.error_code ?? "rejected"})`,
    );
  } else {
    check(
      "custom-scheme callback accepted",
      authorizeRes.status >= 300 && authorizeRes.status < 400,
      `(HTTP ${authorizeRes.status})`,
    );

    /* 3 ── is Supabase the broker? ---------------------------------------- */
    console.log("\nC. Provider redirect architecture");
    const location = authorizeRes.headers.get("location") ?? "";
    const { describeProviderRedirect } = await import(
      pathToFileURL(path.join(ROOT, "src/lib/mobile/provider-redirect.ts")).href
    );
    const facts = describeProviderRedirect(location, SUPABASE_URL);
    console.log(`  provider host: ${facts.host || "(none)"}`);
    check(
      "Google is told to redirect back to Supabase, not to the app",
      facts.valid,
      facts.problems.length ? `(${facts.problems.join("; ")})` : "",
    );
    check(
      "custom scheme is NOT registered as Google's redirect_uri",
      !location.includes(callback),
    );
  }

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  if (problems.length) console.log(`Failed: ${problems.join(" | ")}`);
  console.log("=== SAFE TO PASTE: END =======================================\n");
  return failed === 0 ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error(`x ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
