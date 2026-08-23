/**
 * End-to-end proof of the mobile RPC boundary against a running Next backend,
 * using a REAL Supabase account.
 *
 * Proves this chain:
 *   real account -> Supabase auth -> bearer access token -> /api/mobile RPC
 *   -> server-side JWT validation -> correct user/company context
 *   -> allowlisted method -> existing server business logic -> read-only response
 *
 * SAFETY PROPERTIES (enforced in code below, not merely promised):
 *
 *  - Credentials arrive ONLY via the RPC_TEST_EMAIL / RPC_TEST_PASSWORD
 *    environment variables. Nothing is read from argv, prompted for, or written
 *    to disk. No token is cached.
 *  - Output is redaction-guarded: console.log/console.error are wrapped so the
 *    password, email, access token and refresh token can never appear in the
 *    output, even from an unexpected error message. Anything JWT-shaped is
 *    stripped regardless of whether the script knows about it.
 *  - READ-ONLY. Every RPC this script may invoke is checked against
 *    READ_ONLY_METHODS before the request is made; anything else aborts the
 *    run. Each of those methods, and every helper it reaches, performs only
 *    Prisma findUnique / findFirst / findMany / groupBy / aggregate. No create,
 *    update, delete, upsert, settle, approve, reverse or raw execute is
 *    reachable from here.
 *
 * USAGE (PowerShell):
 *   $env:RPC_TEST_EMAIL="..."; $env:RPC_TEST_PASSWORD="..."
 *   node scripts/verify-mobile-rpc.mjs http://localhost:3001
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3001";
const ROOT = path.resolve(import.meta.dirname, "..");
const RANDOM_UUID = "00000000-dead-4000-8000-000000000abc";

/* ── Read-only call allowlist ─────────────────────────────────────────────
 * A hard gate on what this script itself may invoke. Verified by reading
 * src/features/projects/server/actions.ts and
 * src/features/budget/server-actions.ts:
 *   session.me            -> getCurrentUser -> prisma.user.findUnique
 *   projects.list         -> project.findMany + groupBy/aggregate (spendByProject)
 *   projects.get          -> project.findFirst
 *   projects.listManagers -> user.findMany
 *   projects.getRetention -> company.findUnique
 * Every one is company-scoped by `user.company.id` taken from the verified
 * session, never from client input. */
const READ_ONLY_METHODS = new Set([
  "session.me",
  "projects.list",
  "projects.get",
  "projects.listManagers",
  "projects.getRetention",
]);

/* ── Redaction guard ──────────────────────────────────────────────────── */

const secrets = new Set();

function redact(value) {
  let out = typeof value === "string" ? value : String(value);
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join("[REDACTED]");
  }
  return out.replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED-JWT]");
}

const rawLog = console.log.bind(console);
const rawErr = console.error.bind(console);
console.log = (...a) => rawLog(...a.map(redact));
console.error = (...a) => rawErr(...a.map(redact));

/* ── Config ───────────────────────────────────────────────────────────── */

function loadEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  // Split on CRLF *or* LF. A trailing "\r" would otherwise break the match:
  // JavaScript's `.` does not match `\r` (it is a line terminator), so `(.*)$`
  // can never reach end-of-string on a CRLF file — which is every file in a
  // default Windows checkout.
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/* ── Test harness ─────────────────────────────────────────────────────── */

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  [PASS] ${name}${detail ? `  ${detail}` : ""}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  [FAIL] ${name}${detail ? `  ${detail}` : ""}`);
  }
}

/* ── Main ─────────────────────────────────────────────────────────────── */

async function main() {
  // Only the two PUBLIC Supabase values may come from .env; credentials come
  // exclusively from the process environment.
  const fileEnv = {
    ...loadEnvFile(path.join(ROOT, ".env")),
    ...loadEnvFile(path.join(ROOT, ".env.local")),
  };
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    fileEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const EMAIL = process.env.RPC_TEST_EMAIL;
  const PASSWORD = process.env.RPC_TEST_PASSWORD;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("x Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / publishable key).");
    return 1;
  }
  if (!EMAIL || !PASSWORD) {
    console.error(
      "x Set RPC_TEST_EMAIL and RPC_TEST_PASSWORD (environment variables only).\n" +
        "  They are used once to obtain a short-lived token, and are never stored or printed.",
    );
    return 1;
  }
  secrets.add(PASSWORD);
  secrets.add(EMAIL);

  async function rpc(feature, method, args = [], token, { allowUnlisted = false } = {}) {
    const key = `${feature}.${method}`;
    // Negative tests deliberately probe unregistered names; those never reach a
    // server function (the route 404s at the allowlist), so they are safe.
    if (!allowUnlisted && !READ_ONLY_METHODS.has(key)) {
      throw new Error(`REFUSING to call "${key}" — not in this script's read-only allowlist.`);
    }
    const res = await fetch(`${BASE}/api/mobile/${feature}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ args }),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  console.log("\n=== SAFE TO PASTE: BEGIN =====================================");
  console.log(`Mobile RPC verification against ${BASE}\n`);

  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const auth = await authRes.json().catch(() => ({}));
  if (auth.access_token) secrets.add(auth.access_token);
  if (auth.refresh_token) secrets.add(auth.refresh_token);

  if (!authRes.ok || !auth.access_token) {
    console.error(`x Supabase sign-in failed (HTTP ${authRes.status}).`);
    console.error(`  ${auth.error_description ?? auth.msg ?? auth.error ?? "unknown error"}`);
    console.log("=== SAFE TO PASTE: END =======================================\n");
    return 1;
  }
  const token = auth.access_token;
  console.log("Supabase sign-in: OK (token obtained, never displayed)\n");

  console.log("A. Rejects unauthenticated and forged access");
  check("no Authorization header -> 401", (await rpc("projects", "list", [{}])).status === 401);
  check("garbage token -> 401", (await rpc("projects", "list", [{}], "not-a-token")).status === 401);
  check(
    "forged JWT -> 401 (signature verified server-side)",
    (
      await rpc(
        "projects",
        "list",
        [{}],
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhdHRhY2tlciIsImV4cCI6OTk5OTk5OTk5OX0.forged",
      )
    ).status === 401,
  );

  console.log("\nB. Exposes only the allowlist");
  for (const [feature, method] of [
    ["projects", "__proto__"],
    ["projects", "constructor"],
    ["projects", "listProjects"], // real export name, not the registered key
    ["projects", "removeProject"], // a real MUTATING action — must be unreachable
    ["labor", "listCategories"],
    ["team", "inviteMember"],
    ["__proto__", "list"],
  ]) {
    const { status } = await rpc(feature, method, [], token, { allowUnlisted: true });
    check(`${feature}/${method} -> 404`, status === 404, `(HTTP ${status})`);
  }

  console.log("\nC. Authenticated calls run the real server actions");
  const me = await rpc("session", "me", [], token);
  check("session/me -> 200", me.status === 200, `(HTTP ${me.status})`);
  const user = me.body?.data;
  check("returns the caller's own identity", user?.email?.toLowerCase() === EMAIL.toLowerCase());
  check("resolves exactly one company (tenant scope)", Boolean(user?.company?.id));
  check(
    "resolves RBAC permissions from the database",
    Array.isArray(user?.permissions) && user.permissions.length > 0,
    Array.isArray(user?.permissions) ? `(${user.permissions.length} permissions)` : "",
  );

  const list = await rpc("projects", "list", [{}], token);
  check("projects/list -> 200", list.status === 200, `(HTTP ${list.status})`);
  const projects = list.body?.data;
  check(
    "returns an array from the real listProjects action",
    Array.isArray(projects),
    Array.isArray(projects) ? `(${projects.length} projects)` : "",
  );

  const managers = await rpc("projects", "listManagers", [], token);
  check("projects/listManagers -> 200", managers.status === 200, `(HTTP ${managers.status})`);

  console.log("\nD. Tenant context cannot be supplied or overridden by the client");
  // The company is taken from the verified session and hard-set in every query;
  // ProjectFilters has no companyId field. Injecting one must change nothing.
  const injected = await rpc(
    "projects",
    "list",
    [
      {
        companyId: RANDOM_UUID,
        company: { id: RANDOM_UUID },
        tenantId: RANDOM_UUID,
        organizationId: RANDOM_UUID,
        userId: RANDOM_UUID,
      },
    ],
    token,
  );
  check(
    "injected companyId/tenantId is ignored -> 200",
    injected.status === 200,
    `(HTTP ${injected.status})`,
  );
  check(
    "injected tenant keys do not change the result set",
    JSON.stringify(injected.body?.data) === JSON.stringify(projects),
  );
  check(
    "no companyId is leaked in project payloads",
    Array.isArray(projects) && projects.every((p) => !("companyId" in p)),
  );
  const foreignPm = await rpc("projects", "list", [{ pmId: RANDOM_UUID }], token);
  check(
    "a foreign pmId returns nothing rather than another tenant's rows",
    foreignPm.status === 200 &&
      Array.isArray(foreignPm.body?.data) &&
      foreignPm.body.data.length === 0,
    `(HTTP ${foreignPm.status})`,
  );
  const foreignProject = await rpc("projects", "get", [RANDOM_UUID], token);
  check(
    "an unknown/foreign project id returns null, not data",
    foreignProject.status === 200 && foreignProject.body?.data === null,
    `(HTTP ${foreignProject.status})`,
  );
  const extraArgs = await rpc("projects", "listManagers", [{ companyId: RANDOM_UUID }], token);
  check("extra positional args are ignored", extraArgs.status === 200, `(HTTP ${extraArgs.status})`);

  console.log("\nE. Inherits permission enforcement (not re-implemented)");
  const canView = user?.permissions?.includes("projects.view");
  const canDelete = user?.permissions?.includes("projects.delete");
  check("caller holds projects.view", Boolean(canView));
  const retention = await rpc("projects", "getRetention", [], token);
  if (canDelete) {
    check(
      "holds projects.delete -> getRetention 200",
      retention.status === 200,
      `(HTTP ${retention.status})`,
    );
  } else {
    check(
      "lacks projects.delete -> getRetention 403 FORBIDDEN",
      retention.status === 403,
      `(HTTP ${retention.status})`,
    );
  }

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) console.log(`Failed checks: ${failures.join(" | ")}`);
  console.log("Mutations performed: 0 (read-only methods only)");
  console.log("=== SAFE TO PASTE: END =======================================\n");

  return failed === 0 ? 0 : 1;
}

// Set exitCode rather than calling process.exit(): an abrupt exit while undici
// keep-alive sockets are open triggers a libuv assertion on Node 24/Windows.
try {
  process.exitCode = await main();
} catch (err) {
  console.error(`x ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
