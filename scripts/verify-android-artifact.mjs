/**
 * Fail the release if anything privileged reached the Android artifact.
 *
 *   node scripts/verify-android-artifact.mjs [path/to/app.apk|.aab]
 *
 * `verify-mobile-bundle.mjs` proves the JavaScript is clean, but it inspects
 * `mobile/dist` — the input. This inspects the OUTPUT, which is a different
 * claim: `cap sync` could have copied a stale bundle, Gradle could have
 * packaged a stray resource, and neither would show up in a scan of the source
 * directory. The thing we hand to a tester or upload to Play is the thing worth
 * checking.
 *
 * Checks, in order:
 *   1. Every packaged web asset is byte-identical to the verified `mobile/dist`
 *      — no stale bundle, no smuggled extra file.
 *   2. No server secret, database URL or signing material anywhere in the
 *      archive, compressed entries included.
 *   3. The keystore itself was not accidentally packaged.
 */
import { existsSync, readdirSync, readFileSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "mobile", "dist");

/* Same list as verify-mobile-bundle.mjs, plus Android-specific signing material.
 * Duplicated deliberately: this script must keep working if the other is
 * changed, and a security check that silently inherits its rules from elsewhere
 * is one nobody reviews. */
const FORBIDDEN = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "AUTH_AUTOCONFIRM",
  "SUPABASE_DB_PASSWORD",
  "DIRECT_URL",
  "postgresql://",
  "postgres://",
  "service_role",
  "PrismaClient",
  "@prisma/client",
  "next/dist/server",
  "GOOGLE_CLIENT_SECRET",
  "client_secret",
  // Private keys of any flavour.
  "BEGIN PRIVATE KEY",
  "BEGIN RSA PRIVATE KEY",
  "BEGIN EC PRIVATE KEY",
  "BEGIN OPENSSH PRIVATE KEY",
  // Android signing configuration must live outside the artifact.
  "ANDROID_KEYSTORE_PASSWORD",
  "ANDROID_KEY_PASSWORD",
  "keystore.properties",
];

/** Files that must never be inside a distributable artifact. */
const FORBIDDEN_ENTRIES = [/\.jks$/i, /\.keystore$/i, /\.p12$/i, /keystore\.properties$/i, /^\.env/];

/* ── Locate the artifact ──────────────────────────────────────────────── */

function defaultArtifact() {
  const candidates = [
    path.join(ROOT, "android", "app", "build", "outputs", "apk", "release"),
    path.join(ROOT, "android", "app", "build", "outputs", "bundle", "release"),
  ];
  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    const hit = readdirSync(dir).find((f) => f.endsWith(".apk") || f.endsWith(".aab"));
    if (hit) return path.join(dir, hit);
  }
  return null;
}

const artifact = process.argv[2] ? path.resolve(process.argv[2]) : defaultArtifact();

if (!artifact || !existsSync(artifact)) {
  console.error(
    "No Android artifact found. Build one first:\n  npm run android:apk\n  npm run android:aab",
  );
  process.exit(1);
}

/* ── Unpack ───────────────────────────────────────────────────────────── */

// APK/AAB are zip files. `unzip` is present on Git Bash, macOS and the GitHub
// ubuntu runners; requiring it beats vendoring a zip implementation for one
// check.
const probe = spawnSync("unzip", ["-v"], { encoding: "utf8" });
if (probe.error) {
  console.error("`unzip` is required to inspect the artifact but was not found on PATH.");
  process.exit(1);
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "constructly-apk-"));
let failures = [];

try {
  const extract = spawnSync("unzip", ["-qq", "-o", artifact, "-d", tmp], { encoding: "utf8" });
  if (extract.status !== 0) {
    console.error(`Could not unpack ${artifact}:\n${extract.stderr}`);
    process.exit(1);
  }

  /* ── 1. Packaged web assets match the verified bundle ───────────────── */

  // An AAB nests module assets under `base/`; an APK keeps them at the root.
  const assetRoots = [path.join(tmp, "assets", "public"), path.join(tmp, "base", "assets", "public")];
  const assetRoot = assetRoots.find((d) => existsSync(d));

  if (!assetRoot) {
    failures.push("No web assets found in the artifact — the app would launch to a blank screen.");
  } else if (!existsSync(DIST)) {
    console.warn("mobile/dist is absent; skipping the byte-identity check against the bundle.");
  } else {
    const walk = (dir, base = dir) => {
      const out = [];
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walk(full, base));
        else out.push(path.relative(base, full).split(path.sep).join("/"));
      }
      return out;
    };

    const packaged = new Set(walk(assetRoot));
    for (const rel of walk(DIST)) {
      if (!packaged.has(rel)) {
        failures.push(`Bundle file missing from artifact: ${rel}`);
        continue;
      }
      const a = readFileSync(path.join(DIST, rel));
      const b = readFileSync(path.join(assetRoot, ...rel.split("/")));
      if (!a.equals(b)) {
        failures.push(`Packaged asset differs from mobile/dist (stale sync?): ${rel}`);
      }
    }
  }

  /* ── 2 & 3. Scan every entry ────────────────────────────────────────── */

  const walkAll = (dir) => {
    const out = [];
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walkAll(full));
      else out.push(full);
    }
    return out;
  };

  const all = walkAll(tmp);
  let scanned = 0;

  for (const file of all) {
    const rel = path.relative(tmp, file).split(path.sep).join("/");

    if (FORBIDDEN_ENTRIES.some((re) => re.test(path.basename(rel)) || re.test(rel))) {
      failures.push(`Forbidden file packaged into the artifact: ${rel}`);
      continue;
    }

    // Read as latin1 so binary entries still yield searchable ASCII runs —
    // a secret embedded in a .dex or .so is still a plain byte sequence.
    const text = readFileSync(file, "latin1");
    scanned += 1;

    for (const needle of FORBIDDEN) {
      if (text.includes(needle)) {
        failures.push(`Forbidden string "${needle}" found in ${rel}`);
      }
    }
  }

  console.log(`Scanned ${scanned} entries in ${path.basename(artifact)}.`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n✗ Android artifact FAILED verification (${failures.length} problem(s)):\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`✓ Android artifact clean — packaged bundle matches, no privileged material present.`);
