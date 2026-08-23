/**
 * Build a release Android artifact.
 *
 *   node scripts/android-build.mjs apk   → android/app/build/outputs/apk/release/
 *   node scripts/android-build.mjs aab   → android/app/build/outputs/bundle/release/
 *
 * Exists rather than "just run gradlew" for three reasons, each of which has
 * already cost a build somewhere:
 *
 *  1. Gradle needs a JDK, and on a Windows developer machine the only one
 *     present is usually the JetBrains Runtime inside Android Studio, which is
 *     not on PATH and not in JAVA_HOME. Finding it here beats each person
 *     rediscovering it.
 *  2. `local.properties` is gitignored (it holds a machine-specific SDK path),
 *     so a fresh clone cannot build until it is written. It is derived, not
 *     authored — so derive it.
 *  3. Gradle happily emits an UNSIGNED release artifact. Unsigned APKs will not
 *     install, and unsigned AABs are rejected by Play — both of which surface
 *     far away from the build that caused them. This reports signing state
 *     explicitly, at the end, where it is read.
 *
 * Never prints a password, an alias or a keystore path.
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(import.meta.dirname, "..");
const ANDROID = path.join(ROOT, "android");

const target = (process.argv[2] ?? "").toLowerCase();
const TARGETS = {
  apk: { task: "assembleRelease", dir: ["app", "build", "outputs", "apk", "release"], ext: ".apk" },
  aab: { task: "bundleRelease", dir: ["app", "build", "outputs", "bundle", "release"], ext: ".aab" },
};

if (!(target in TARGETS)) {
  console.error(`Usage: node scripts/android-build.mjs <apk|aab>  (got: ${target || "nothing"})`);
  process.exit(2);
}
const { task, dir, ext } = TARGETS[target];

/* ── JDK ──────────────────────────────────────────────────────────────────
 * AGP 8.13 / Gradle 8.14 run on JDK 17 or 21 (21 is the current LTS and what
 * CI uses). They do NOT run on 24+: Gradle's embedded Groovy cannot read those
 * class files and the build dies during configuration with the memorable
 * "Unsupported class file major version", which names no cause and points at
 * no file.
 *
 * Android Studio bundles its own JetBrains Runtime, which is currently 25 — so
 * on a normal Windows machine the most discoverable JDK is exactly the one that
 * does not work. Hence: search for a SUPPORTED version, and if only an
 * unsupported one is present, say so in those words instead of letting Gradle
 * fail obscurely.
 */

const SUPPORTED_JDK = [17, 21];

/** Major version of a JDK at `home`, or null if it cannot be determined. */
function jdkMajor(home) {
  const java = path.join(home, "bin", process.platform === "win32" ? "java.exe" : "java");
  if (!existsSync(java)) return null;
  // `java -version` writes to stderr, on every JDK, by long-standing design.
  const out = spawnSync(java, ["-version"], { encoding: "utf8" });
  const text = `${out.stderr ?? ""}${out.stdout ?? ""}`;
  const m = text.match(/version "(\d+)/);
  return m ? Number(m[1]) : null;
}

function jdkCandidates() {
  const home = os.homedir();
  const found = [];

  // Explicit choice always wins.
  if (process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME)) {
    found.push(process.env.JAVA_HOME);
  }

  // Standalone JDKs, in the location Android Studio and IntelliJ also scan.
  const jdksDir = path.join(home, ".jdks");
  if (existsSync(jdksDir)) {
    for (const entry of readdirSync(jdksDir)) {
      found.push(path.join(jdksDir, entry));
    }
  }

  if (process.platform === "win32") {
    for (const base of ["C:\\Program Files\\Eclipse Adoptium", "C:\\Program Files\\Java"]) {
      if (existsSync(base)) {
        for (const entry of readdirSync(base)) found.push(path.join(base, entry));
      }
    }
    found.push("C:\\Program Files\\Android\\Android Studio\\jbr");
  } else if (process.platform === "darwin") {
    const vms = "/Library/Java/JavaVirtualMachines";
    if (existsSync(vms)) {
      for (const entry of readdirSync(vms)) {
        found.push(path.join(vms, entry, "Contents", "Home"));
      }
    }
    found.push("/Applications/Android Studio.app/Contents/jbr/Contents/Home");
  } else {
    const vms = "/usr/lib/jvm";
    if (existsSync(vms)) {
      for (const entry of readdirSync(vms)) found.push(path.join(vms, entry));
    }
  }

  return found.filter((c) => existsSync(c));
}

function findJdk() {
  const seen = [];
  for (const home of jdkCandidates()) {
    const major = jdkMajor(home);
    if (major === null) continue;
    seen.push({ home, major });
    if (SUPPORTED_JDK.includes(major)) return { home, major, rejected: seen };
  }
  return { home: null, major: null, rejected: seen };
}

const jdk = findJdk();
if (!jdk.home) {
  console.error(
    `No supported JDK found. The Android build needs JDK ${SUPPORTED_JDK.join(" or ")}.`,
  );
  if (jdk.rejected.length) {
    console.error("\nFound, but not usable:");
    for (const { home, major } of jdk.rejected) {
      console.error(`  JDK ${major}  ${home}`);
    }
    console.error(
      "\nJDK 24+ cannot run Gradle 8.14 / AGP 8.13 — Android Studio's bundled\n" +
        "runtime is often too new. Install Temurin 21 and either set JAVA_HOME or\n" +
        `unpack it into ${path.join(os.homedir(), ".jdks")}:\n` +
        "  https://adoptium.net/temurin/releases/?version=21",
    );
  }
  process.exit(1);
}
const javaHome = jdk.home;

/* ── Android SDK ──────────────────────────────────────────────────────── */

function findSdk() {
  for (const v of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) {
    if (v && existsSync(v)) return v;
  }
  const candidates =
    process.platform === "win32"
      ? [path.join(os.homedir(), "AppData", "Local", "Android", "Sdk")]
      : process.platform === "darwin"
        ? [path.join(os.homedir(), "Library", "Android", "sdk")]
        : [path.join(os.homedir(), "Android", "Sdk")];
  return candidates.find((c) => existsSync(c)) ?? null;
}

const sdk = findSdk();
if (!sdk) {
  console.error(
    "No Android SDK found. Install it via Android Studio, or set ANDROID_HOME to an existing SDK.",
  );
  process.exit(1);
}

// Derived, not authored — safe to (re)write on every build.
const localProps = path.join(ANDROID, "local.properties");
const desired = `sdk.dir=${sdk.replace(/\\/g, "\\\\")}\n`;
if (!existsSync(localProps) || readFileSync(localProps, "utf8") !== desired) {
  writeFileSync(localProps, desired);
}

/* ── Build ────────────────────────────────────────────────────────────── */

console.log(`── Constructly Android ─────────────────────────────`);
console.log(`target     ${target.toUpperCase()}  (gradle :app:${task})`);
console.log(`JDK        ${javaHome} (Java ${jdk.major})`);
console.log(`SDK        ${sdk}`);

const version = Object.fromEntries(
  readFileSync(path.join(ANDROID, "version.properties"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => l.split("=").map((s) => s.trim())),
);
console.log(`version    ${version.versionName} (code ${version.versionCode})`);
console.log(`────────────────────────────────────────────────────`);

// Windows cannot exec a .bat directly, and `shell: true` would concatenate the
// arguments into a command string (Node flags that as an injection risk, and it
// mangles paths containing spaces — "Program Files" is right there in
// JAVA_HOME). Invoking cmd.exe explicitly keeps the arguments as an array.
const wrapper = path.join(ANDROID, process.platform === "win32" ? "gradlew.bat" : "gradlew");
const args = [`:app:${task}`, "--no-daemon"];
const [command, commandArgs] =
  process.platform === "win32" ? ["cmd.exe", ["/c", wrapper, ...args]] : [wrapper, args];

const result = spawnSync(command, commandArgs, {
  cwd: ANDROID,
  stdio: "inherit",
  env: { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk },
});

if (result.status !== 0) {
  console.error(`\nGradle failed (exit ${result.status}).`);
  process.exit(result.status ?? 1);
}

/* ── Report ───────────────────────────────────────────────────────────── */

const outDir = path.join(ANDROID, ...dir);
if (!existsSync(outDir)) {
  console.error(`\nGradle reported success but produced no output directory: ${outDir}`);
  process.exit(1);
}

const artifacts = readdirSync(outDir).filter((f) => f.endsWith(ext));
if (artifacts.length === 0) {
  console.error(`\nGradle reported success but produced no ${ext} in ${outDir}`);
  process.exit(1);
}

console.log(`\n── Artifact ────────────────────────────────────────`);
for (const name of artifacts) {
  const full = path.join(outDir, name);
  const mb = (statSync(full).size / 1024 / 1024).toFixed(1);
  console.log(`${full}  (${mb} MB)`);

  // An unsigned release is a real outcome, not an edge case — Gradle names it
  // so, and it will neither install nor upload. Say it here, loudly.
  if (name.includes("unsigned")) {
    console.log(
      `\n  ⚠ UNSIGNED. This artifact cannot be installed on a device or uploaded to Play.\n` +
        `    Configure signing (android/keystore.properties or ANDROID_KEYSTORE_* env)\n` +
        `    — see docs/android-signing.md.`,
    );
  }
}
console.log(`────────────────────────────────────────────────────`);
