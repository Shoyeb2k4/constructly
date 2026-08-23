/**
 * Refuse to let code-signing material into the repository — Apple's and Android's.
 *
 * Signing assets are supposed to exist in exactly two places: your machine (or
 * Apple's servers), and transiently on the macOS runner during a build. They
 * must never be committed — a leaked `.p12` plus its password lets someone sign
 * code as you, and a leaked provisioning profile leaks your Team ID and every
 * registered device UDID.
 *
 * This scans TRACKED files only, so it is fast and cannot be fooled by
 * gitignored scratch copies (which are fine — they are not in history).
 *
 * Usage: node scripts/verify-no-signing-material.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

/** Extensions that are always signing material — no legitimate reason to commit. */
const FORBIDDEN_EXTENSIONS = [
  ".p12",
  ".pfx",
  ".cer",
  ".certSigningRequest",
  ".mobileprovision",
  ".provisionprofile",
  ".keystore",
  ".jks",
];

/** Content signatures, checked inside text files. */
const FORBIDDEN_CONTENT = [
  { pattern: /-----BEGIN (RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/, what: "a private key" },
  { pattern: /-----BEGIN CERTIFICATE-----/, what: "a certificate" },
  // An embedded mobileprovision plist, base64-encoded or raw.
  { pattern: /<key>ProvisionedDevices<\/key>/, what: "a provisioning profile" },
  { pattern: /<key>DeveloperCertificates<\/key>/, what: "a provisioning profile" },
  // Apple App Store Connect API keys.
  { pattern: /-----BEGIN PRIVATE KEY-----[\s\S]*AuthKey_/, what: "an App Store Connect key" },
];

/** Secret NAMES that must never appear with an inline value assigned. */
const FORBIDDEN_ASSIGNMENTS = [
  /IOS_DEVELOPMENT_CERTIFICATE_BASE64\s*[=:]\s*["']?[A-Za-z0-9+/]{40,}/,
  /IOS_DEVELOPMENT_CERTIFICATE_PASSWORD\s*[=:]\s*["'][^"']{3,}/,
  /IOS_PROVISIONING_PROFILE_BASE64\s*[=:]\s*["']?[A-Za-z0-9+/]{40,}/,
  /KEYCHAIN_PASSWORD\s*[=:]\s*["'][^"']{3,}/,
  // ── Android ──────────────────────────────────────────────────────────
  // The upload key is the credential that says a build is ours. Committing
  // it (or its password) means it can never be trusted again, and it cannot
  // be un-published from git history.
  /ANDROID_KEYSTORE_BASE64\s*[=:]\s*["']?[A-Za-z0-9+/]{40,}/,
  /ANDROID_KEYSTORE_PASSWORD\s*[=:]\s*["'][^"']{3,}/,
  /ANDROID_KEY_PASSWORD\s*[=:]\s*["'][^"']{3,}/,
  /ANDROID_KEY_ALIAS\s*[=:]\s*["'][^"']{3,}/,
  // Gradle reads these names out of android/keystore.properties, which is
  // gitignored. Seeing one with a value in a TRACKED file means that file
  // escaped the ignore rules.
  /^\s*storePassword\s*=\s*\S+/m,
  /^\s*keyPassword\s*=\s*\S+/m,
];

/**
 * This scanner necessarily contains every pattern it searches for, so it would
 * otherwise flag itself. Exempted from CONTENT checks only, and named
 * explicitly so no other file can become self-exempting.
 */
const SELF = "scripts/verify-no-signing-material.mjs";

/**
 * Files that legitimately mention secret NAMES: the workflow wires them up, docs
 * describe them, .gitignore excludes their file types. They are still checked
 * for actual key/certificate CONTENT — a real key pasted into a workflow is
 * exactly as dangerous as one pasted anywhere else.
 */
function mayReferenceSecretNames(file) {
  return (
    file === SELF ||
    file.startsWith(".github/workflows/") ||
    file.endsWith(".md") ||
    file === ".gitignore"
  );
}

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .map((f) => f.trim())
  .filter(Boolean);

const findings = [];

for (const file of tracked) {
  const lower = file.toLowerCase();

  for (const ext of FORBIDDEN_EXTENSIONS) {
    if (lower.endsWith(ext.toLowerCase())) {
      findings.push(`${file}: committed signing material (${ext})`);
    }
  }

  // Only read plausibly-text files, and skip anything large.
  let size = 0;
  try {
    size = statSync(file).size;
  } catch {
    continue;
  }
  if (size > 2_000_000) continue;
  if (/\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|car|xcassets)$/i.test(file)) continue;

  let contents;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  if (file !== SELF) {
    for (const { pattern, what } of FORBIDDEN_CONTENT) {
      if (pattern.test(contents)) findings.push(`${file}: contains ${what}`);
    }
  }

  if (!mayReferenceSecretNames(file)) {
    for (const pattern of FORBIDDEN_ASSIGNMENTS) {
      if (pattern.test(contents)) {
        findings.push(`${file}: a signing secret appears to be assigned inline`);
      }
    }
  }
}

if (findings.length > 0) {
  console.error("x Apple signing material found in tracked files:\n");
  for (const f of findings) console.error(`  ${f}`);
  console.error(
    "\nSigning assets belong in GitHub Actions Secrets and on the runner only.\n" +
      "Remove the file, rotate the credential, and purge it from history if it was pushed.",
  );
  process.exit(1);
}

console.log(`OK no signing material in ${tracked.length} tracked files.`);
