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

// 1. Verify both connections.
for (const [name, url] of [["session (5432)", DIRECT_URL], ["transaction (6543)", DATABASE_URL.split("?")[0]]]) {
  try {
    run(`npx prisma db execute --url "${url}" --stdin`, { input: "select 1;" });
    console.log(`✓ Postgres ${name} connection OK`);
  } catch (e) {
    console.error(`✗ Postgres ${name} FAILED — is the password correct?`);
    process.exit(1);
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
