/**
 * Prove the backend an artifact points at can actually serve the mobile app.
 *
 *   node scripts/verify-mobile-backend.mjs [origin]
 *
 * WHY THIS EXISTS — a signed APK was installed on a real phone and died on
 * launch with "Failed to fetch". Everything about the artifact was correct: the
 * right package, the right signature, the right production URL baked in. What
 * was wrong was the other end. `/api/mobile/*` had never been deployed, so the
 * CORS preflight hit Next's 404 page, which carries no
 * `Access-Control-Allow-Origin`, so the WebView blocked the request before it
 * was ever sent. Nothing in the build could tell.
 *
 * The build knows the exact origin it is compiling against. It should therefore
 * refuse to produce a release artifact for a backend that cannot serve it. That
 * is the whole job of this script.
 *
 * WHAT IT CHECKS — the real contract, from the client's point of view:
 *   1. the origin is reachable at all;
 *   2. `/api/mobile/session/me` EXISTS (the app's very first call);
 *   3. its preflight returns the CORS headers the WebView requires;
 *   4. a hostile origin is still refused.
 *
 * UNREACHABLE IS NOT FAILURE. A build on a laptop with no network, or against a
 * CI placeholder, cannot verify anything — that is reported as "cannot verify"
 * and does not fail, matching how the OAuth provider check already behaves. A
 * backend that ANSWERS but answers wrongly is a hard failure: that is the case
 * that shipped a dead app.
 */
import process from "node:process";

/** Origins the native shells actually use — mirrors src/app/api/mobile/cors.ts. */
const NATIVE_ORIGINS = [
  { origin: "https://localhost", platform: "Android (androidScheme: https)" },
  { origin: "capacitor://localhost", platform: "iOS (iosScheme: capacitor)" },
];

/** Must never be granted access. */
const HOSTILE_ORIGIN = "https://evil.example";

/** The first call the app makes at boot — see mobile/src/session-gate.tsx. */
const PROBE_PATH = "/api/mobile/session/me";

const TIMEOUT_MS = 20_000;

const base = (process.argv[2] ?? process.env.NEXT_PUBLIC_MOBILE_API_BASE ?? "").replace(/\/$/, "");

if (!base) {
  console.log(
    "NEXT_PUBLIC_MOBILE_API_BASE is not set — nothing to verify.\n" +
      "(A demo build never touches the network; a real build sets this.)",
  );
  process.exit(0);
}

// A placeholder is a deliberate "no backend here", not a broken one.
if (/(^https?:\/\/)?(ci-placeholder|example\.invalid|\.invalid$)/i.test(base)) {
  console.log(`Backend is a placeholder (${base}) — cannot verify, not failing.`);
  process.exit(0);
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: "manual" });
  } finally {
    clearTimeout(timer);
  }
}

const failures = [];
const notes = [];

console.log(`\nConstructly mobile backend verification`);
console.log(`backend under test: ${base}`);
console.log(`probe:              POST ${PROBE_PATH}\n`);

/* ── 1. Reachable at all? ─────────────────────────────────────────────── */

try {
  const res = await fetchWithTimeout(`${base}/api/health`, { method: "GET" });
  console.log(`A. Reachability`);
  console.log(`  [PASS] ${base}/api/health responded ${res.status}`);
} catch (err) {
  console.log(`A. Reachability`);
  console.log(`  [SKIP] ${base} is unreachable (${err?.name ?? "error"}) — cannot verify.`);
  console.log(`\nRESULT: cannot verify (offline or backend down). Not failing the build.`);
  process.exit(0);
}

/* ── 2 & 3. Does the mobile API exist, with usable CORS? ──────────────── */

console.log(`\nB. Mobile API preflight`);

for (const { origin, platform } of NATIVE_ORIGINS) {
  let res;
  try {
    res = await fetchWithTimeout(`${base}${PROBE_PATH}`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
  } catch (err) {
    failures.push(`preflight from ${origin} threw: ${err?.name ?? "error"}`);
    continue;
  }

  const allowOrigin = res.headers.get("access-control-allow-origin");
  const allowHeaders = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
  const allowMethods = (res.headers.get("access-control-allow-methods") ?? "").toUpperCase();

  // The tell-tale of an undeployed route: Next serves its 404 page, which has
  // no CORS headers at all. Name it explicitly — "no ACAO" is true but does not
  // tell anyone what to do about it.
  const matchedPath = res.headers.get("x-matched-path");
  const looks404 = matchedPath === "/404" || res.status === 404;

  if (looks404 && !allowOrigin) {
    failures.push(
      `${PROBE_PATH} does not exist on ${base} (matched ${matchedPath ?? res.status}). ` +
        `The mobile API has not been deployed to this backend.`,
    );
    console.log(`  [FAIL] ${origin}  — route not deployed (${matchedPath ?? res.status})`);
    continue;
  }

  if (allowOrigin !== origin) {
    failures.push(
      `preflight from ${origin} returned Access-Control-Allow-Origin=${allowOrigin ?? "<none>"}`,
    );
    console.log(`  [FAIL] ${origin}  — ACAO ${allowOrigin ?? "<none>"}`);
    continue;
  }
  if (!allowHeaders.includes("authorization") || !allowHeaders.includes("content-type")) {
    failures.push(`preflight from ${origin} does not allow Authorization + Content-Type`);
    console.log(`  [FAIL] ${origin}  — allow-headers "${allowHeaders}"`);
    continue;
  }
  if (!allowMethods.includes("POST")) {
    failures.push(`preflight from ${origin} does not allow POST`);
    console.log(`  [FAIL] ${origin}  — allow-methods "${allowMethods}"`);
    continue;
  }

  console.log(`  [PASS] ${origin}  — ${platform}`);
}

/* ── 4. A hostile origin must still be refused ────────────────────────── */

console.log(`\nC. Hostile origin`);
try {
  const res = await fetchWithTimeout(`${base}${PROBE_PATH}`, {
    method: "OPTIONS",
    headers: { Origin: HOSTILE_ORIGIN, "Access-Control-Request-Method": "POST" },
  });
  const allowOrigin = res.headers.get("access-control-allow-origin");
  if (allowOrigin === HOSTILE_ORIGIN || allowOrigin === "*") {
    failures.push(`${HOSTILE_ORIGIN} was granted access (ACAO=${allowOrigin})`);
    console.log(`  [FAIL] ${HOSTILE_ORIGIN} was allowed (ACAO=${allowOrigin})`);
  } else {
    console.log(`  [PASS] ${HOSTILE_ORIGIN} refused (ACAO=${allowOrigin ?? "<none>"})`);
  }
} catch {
  notes.push("hostile-origin probe could not complete");
  console.log(`  [SKIP] probe did not complete`);
}

/* ── Result ───────────────────────────────────────────────────────────── */

for (const note of notes) console.log(`\nnote: ${note}`);

if (failures.length) {
  console.error(`\nRESULT: ${failures.length} problem(s) — refusing to certify this backend.\n`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    `\nAn artifact built against ${base} will fail on launch with "Failed to fetch".\n` +
      `Deploy the branch carrying src/app/api/mobile/** to that backend, then rebuild.\n`,
  );
  process.exit(1);
}

console.log(`\nRESULT: ${base} can serve the mobile app.\n`);
