/**
 * Bring a fresh STAGING Supabase project up to a testable state.
 *
 *   node scripts/staging-provision.mjs
 *
 * Reads `.env.staging` (gitignored) and, in order:
 *   1. refuses point-blank to run against production;
 *   2. pushes the Prisma schema;
 *   3. applies RLS policies;
 *   4. creates the sign-in identities in Supabase Auth, capturing their ids;
 *   5. seeds the fixture with those ids.
 *
 * STEP 4 BEFORE STEP 5 IS NOT COSMETIC. `resolveSessionUser` looks the
 * application user up by the AUTH user's id, so a fixture row whose id was
 * chosen locally resolves to no session — a correct password lands on
 * NO_WORKSPACE and looks like a permissions bug. Auth assigns the id; the seed
 * has to be told what it was.
 *
 * Passwords are generated here, printed ONCE, and never written to disk or to
 * the repository. They are throwaway staging credentials for fixture accounts
 * that exist only in a disposable database — they are not anybody's real
 * credentials, and no production identity is touched.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENV_FILE = path.join(ROOT, ".env.staging");

/** The one database this script must never touch. */
const PRODUCTION_REF = "rbteppevgibwddihqcpf";

/* ── Environment ──────────────────────────────────────────────────────── */

if (!existsSync(ENV_FILE)) {
  console.error(
    `Missing ${ENV_FILE}\n\n` +
      `Create it with the STAGING project's values:\n\n` +
      `  NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co\n` +
      `  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…\n` +
      `  SUPABASE_SERVICE_ROLE_KEY=…\n` +
      `  DATABASE_URL=postgresql://…\n` +
      `  DIRECT_URL=postgresql://…\n`,
  );
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(ENV_FILE, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "DIRECT_URL",
];
const missing = required.filter((k) => !env[k]);
if (missing.length) {
  console.error(`.env.staging is missing: ${missing.join(", ")}`);
  process.exit(1);
}

/* ── The guard that matters ───────────────────────────────────────────── */

for (const [key, value] of Object.entries(env)) {
  if (typeof value === "string" && value.includes(PRODUCTION_REF)) {
    console.error(
      `\nREFUSING TO RUN.\n\n` +
        `${key} in .env.staging points at the PRODUCTION project (${PRODUCTION_REF}).\n` +
        `This script pushes schema and writes fixture data. It must only ever\n` +
        `target a disposable staging database.\n`,
    );
    process.exit(1);
  }
}

const stagingRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0];
console.log(`\nStaging project: ${stagingRef}`);
console.log(`Production ref : ${PRODUCTION_REF}  (guard active)\n`);

const childEnv = { ...process.env, ...env };

function run(label, file, args) {
  console.log(`── ${label}`);
  execFileSync(file, args, { cwd: ROOT, stdio: "inherit", env: childEnv, shell: true });
}

/* ── 1. Schema ────────────────────────────────────────────────────────── */

// `db push` rather than `migrate deploy`: this repository has no Prisma
// migrations directory — the schema is the source of truth and the SQL files
// under prisma/ are incremental patches for an ALREADY-provisioned database.
// A fresh database wants the schema itself.
run("Pushing Prisma schema", "npx", ["prisma", "db", "push", "--skip-generate"]);

/* ── 2. RLS ───────────────────────────────────────────────────────────── */

const rls = path.join(ROOT, "prisma", "rls.sql");
if (existsSync(rls)) {
  console.log(`── Applying RLS policies`);
  execFileSync("npx", ["prisma", "db", "execute", "--file", rls, "--schema", "prisma/schema.prisma"], {
    cwd: ROOT,
    stdio: "inherit",
    env: childEnv,
    shell: true,
  });
} else {
  console.log(`── No prisma/rls.sql — skipping RLS`);
}

/* ── 3. Auth identities ───────────────────────────────────────────────── */

/** 24 bytes of base64url: ample for a throwaway fixture account. */
function generatePassword() {
  return randomBytes(24).toString("base64url");
}

const IDENTITIES = [
  { key: "STAGING_OWNER_A_ID", email: "owner@staging.constructly.app", label: "Owner · Meridian" },
  { key: "STAGING_ENGINEER_A_ID", email: "engineer@staging.constructly.app", label: "Site Engineer · Meridian" },
  { key: "STAGING_OWNER_B_ID", email: "owner.northgate@staging.constructly.app", label: "Owner · Northgate" },
];

const adminHeaders = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

console.log(`── Creating auth identities`);

const created = [];
for (const identity of IDENTITIES) {
  // Reuse an existing user if this is a re-run, so ids stay stable.
  const listRes = await fetch(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=200`,
    { headers: adminHeaders },
  );
  const listed = listRes.ok ? await listRes.json() : { users: [] };
  const existing = (listed.users ?? []).find((u) => u.email === identity.email);

  const password = generatePassword();

  if (existing) {
    // Reset the password so the operator always leaves with a working one.
    const patch = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${existing.id}`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ password, email_confirm: true }),
    });
    if (!patch.ok) {
      console.error(`  ! could not reset ${identity.email}: HTTP ${patch.status}`);
      process.exit(1);
    }
    created.push({ ...identity, id: existing.id, password, reused: true });
    console.log(`  reused  ${identity.email}`);
    continue;
  }

  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ email: identity.email, password, email_confirm: true }),
  });
  if (!res.ok) {
    console.error(`  ! could not create ${identity.email}: HTTP ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const user = await res.json();
  created.push({ ...identity, id: user.id, password, reused: false });
  console.log(`  created ${identity.email}`);
}

/* ── 4. Fixture ───────────────────────────────────────────────────────── */

for (const c of created) childEnv[c.key] = c.id;

run("Seeding staging fixture", "npx", ["tsx", "prisma/seed-staging.ts"]);

/* ── 5. Hand over ─────────────────────────────────────────────────────── */

console.log(`\n╭─ STAGING SIGN-IN DETAILS ─────────────────────────────────`);
console.log(`│ Shown once. Not written to disk, not committed.`);
console.log(`│ Throwaway accounts in a disposable database.`);
console.log(`├───────────────────────────────────────────────────────────`);
for (const c of created) {
  console.log(`│ ${c.label}`);
  console.log(`│   ${c.email}`);
  console.log(`│   ${c.password}`);
}
console.log(`╰───────────────────────────────────────────────────────────\n`);

// A pointer file for the operator — ids only, never passwords.
writeFileSync(
  path.join(ROOT, ".env.staging.ids"),
  created.map((c) => `${c.key}=${c.id}`).join("\n") + "\n",
);
console.log(`Auth ids written to .env.staging.ids (gitignored, no secrets).`);
console.log(`Staging ready: ${stagingRef}\n`);
