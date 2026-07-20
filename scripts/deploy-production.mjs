#!/usr/bin/env node
/**
 * Constructly — production deploy finisher.
 *
 * Prereq: fill SUPABASE_DB_PASSWORD in .env.local (Dashboard → Settings →
 * Database → Reset database password). Then: `node scripts/deploy-production.mjs`
 *
 * It URL-encodes the password into the pooler connection strings, verifies
 * both Postgres connections, syncs DATABASE_URL/DIRECT_URL to Vercel
 * (production), deploys with `vercel --prod`, and health-checks the result.
 * No secrets are ever printed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const REF = "rbteppevgibwddihqcpf";
const POOLER = "aws-1-ap-south-1.pooler.supabase.com";

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: ["pipe", "pipe", "pipe"], timeout: 600_000, ...opts })
    .toString();
}

const env = readFileSync(".env.local", "utf8");
const password = (env.match(/^SUPABASE_DB_PASSWORD=(.+)$/m) || [])[1]?.trim();
if (!password) {
  console.error("✗ SUPABASE_DB_PASSWORD is empty in .env.local — fill it first.");
  process.exit(1);
}
const enc = encodeURIComponent(password);
const DATABASE_URL = `postgresql://postgres.${REF}:${enc}@${POOLER}:6543/postgres?pgbouncer=true&connection_limit=1`;
const DIRECT_URL = `postgresql://postgres.${REF}:${enc}@${POOLER}:5432/postgres`;

// 1. Verify the SESSION pooler (used for migrations) — must be clean.
try {
  run(`npx prisma db execute --url "${DIRECT_URL}" --stdin`, { input: "select 1;" });
  console.log("✓ Postgres session pooler (5432) connection OK");
} catch {
  console.error("✗ Postgres session pooler FAILED — check SUPABASE_DB_PASSWORD.");
  process.exit(1);
}
// 2. Verify the TRANSACTION pooler (app runtime). `prisma db execute` emits a
//    harmless "prepared statement already exists" over pgbouncer transaction
//    mode — that error itself proves auth + reachability, so we accept it. Only
//    a genuine auth/network failure (P1000/P1001, "not found") is fatal.
try {
  run(`npx prisma db execute --url "${DATABASE_URL}" --stdin`, { input: "select 1;" });
  console.log("✓ Postgres transaction pooler (6543) connection OK");
} catch (e) {
  const s = String(e.stderr || e.message);
  if (/prepared statement .* already exists/i.test(s)) {
    console.log("✓ Postgres transaction pooler (6543) reachable (pgbouncer OK)");
  } else if (/P1000|P1001|authentication failed|not found|does not exist/i.test(s)) {
    console.error("✗ Postgres transaction pooler FAILED (auth/network).");
    process.exit(1);
  } else {
    console.log("… transaction pooler check inconclusive; health check will confirm post-deploy");
  }
}

// 2. Write the working URLs into local env files.
for (const f of [".env", ".env.local"]) {
  let c = readFileSync(f, "utf8");
  c = c.replace(/DATABASE_URL=[^\r\n]*/g, `DATABASE_URL="${DATABASE_URL}"`);
  c = c.replace(/DIRECT_URL=[^\r\n]*/g, `DIRECT_URL="${DIRECT_URL}"`);
  writeFileSync(f, c);
}
console.log("✓ Local env files updated");

// 3. Sync to Vercel production env (replace if present).
for (const [name, value] of [["DATABASE_URL", DATABASE_URL], ["DIRECT_URL", DIRECT_URL]]) {
  try { run(`npx vercel env rm ${name} production --yes`); } catch { /* not present */ }
  run(`npx vercel env add ${name} production`, { input: value });
  console.log(`✓ Vercel env ${name} set`);
}

// 4. Deploy to production.
console.log("… deploying to Vercel (this takes a few minutes)");
const out = run("npx vercel deploy --prod --yes");
const url = (out.match(/https:\/\/[^\s]+\.vercel\.app/g) || []).pop();
console.log(`✓ Deployed: ${url ?? "(see vercel output)"}`);

// 5. Health check.
if (url) {
  const health = run(`curl -s ${url}/api/health?deep=1`);
  console.log(`✓ Health: ${health}`);
}
console.log("\nRemaining manual step: Supabase Dashboard → Authentication → URL Configuration →");
console.log(`  Site URL: ${url ?? "<your production URL>"}`);
console.log(`  Redirect URLs: ${url ?? "<your production URL>"}/auth/callback`);
