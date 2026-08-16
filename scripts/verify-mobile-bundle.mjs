/**
 * Fail the mobile build if anything server-only reached the bundle.
 *
 * The mobile SPA compiles the same `src/` tree as the Next.js app, and that tree
 * legitimately contains Prisma queries, the service-role key and database URLs.
 * The Vite config is written so none of it can be reached (an explicit
 * `define` allowlist plus `mobile/server-stub-plugin.ts` cutting the import
 * graph at the server boundary), but "written so it can't happen" is not
 * evidence. This is the evidence, and it runs before every `cap sync`.
 *
 * Scans the built assets rather than the source, so it catches a leak no matter
 * how it got there — a new import, a bundler change, a careless `define`.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const DIST = path.resolve(import.meta.dirname, "..", "mobile", "dist");

/** Substrings that must never appear in a client bundle. */
const FORBIDDEN = [
  // Server-only environment variables (names AND obvious value shapes).
  "SUPABASE_SERVICE_ROLE_KEY",
  "AUTH_AUTOCONFIRM",
  "SUPABASE_DB_PASSWORD",
  "DIRECT_URL",
  "postgresql://",
  "postgres://",
  // The service-role JWT declares its own role in the payload.
  "service_role",
  // Database layer — its presence means the server import graph was not cut.
  "PrismaClient",
  "@prisma/client",
  // Next.js server-action runtime.
  "next/dist/server",
];

/**
 * `DATABASE_URL` is checked separately: the literal string can legitimately
 * appear inside a comment-stripped Prisma type name, so we look for it being
 * READ, which is what would actually leak a value.
 */
const FORBIDDEN_PATTERNS = [/process\.env\.DATABASE_URL/, /process\s*\.\s*env\s*\.\s*[A-Z_]*SECRET/];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(js|mjs|css|html|map)$/.test(entry)) out.push(full);
  }
  return out;
}

if (!existsSync(DIST)) {
  console.error(`✗ ${path.relative(process.cwd(), DIST)} does not exist — run the mobile build first.`);
  process.exit(1);
}

const files = walk(DIST);
if (files.length === 0) {
  console.error("✗ No build output found to scan.");
  process.exit(1);
}

const findings = [];
for (const file of files) {
  const contents = readFileSync(file, "utf8");
  const rel = path.relative(process.cwd(), file);

  for (const needle of FORBIDDEN) {
    if (contents.includes(needle)) findings.push(`${rel}: contains "${needle}"`);
  }
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(contents)) findings.push(`${rel}: matches ${pattern}`);
  }
}

if (findings.length > 0) {
  console.error("✗ Server-only material found in the mobile bundle:\n");
  for (const f of findings) console.error(`  ${f}`);
  console.error("\nRefusing to sync. See mobile/vite.config.ts and mobile/server-stub-plugin.ts.");
  process.exit(1);
}

console.log(`✓ Mobile bundle clean — scanned ${files.length} files, no server secrets present.`);
