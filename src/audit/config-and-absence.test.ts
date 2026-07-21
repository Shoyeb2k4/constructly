/**
 * AUDIT — Configuration behavior + absence proofs.
 *
 * Executable evidence for findings that are about what the code DOESN'T do:
 *  - env fails OPEN (silently serves demo) on a missing key
 *  - no password-reset / invite flow exists in the source
 *  - error reporting is a stub (no real monitoring dependency)
 *  - app-level rate limiting is wired to exactly one route
 *
 * These scan the real repository on disk, so they are execution-backed, not
 * assertions of belief.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "generated" || name === "node_modules") continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}
const FILES = walk(SRC);
const grepSrc = (re: RegExp) => FILES.filter((f) => re.test(readFileSync(f, "utf8")));

/* ═══════════════════════════════════════════════════════════════════════
 * HIGH — env fails OPEN: a missing key silently degrades to demo mode
 * ═══════════════════════════════════════════════════════════════════════ */
describe("HIGH: environment validation fails open", () => {
  it("serves DEMO mode when the publishable key is missing, even with a URL set", async () => {
    const saved = { ...process.env };
    // Simulate a production deploy that set the URL but forgot the key.
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://real.supabase.co";
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.CONSTRUCTLY_DEMO;

    const { resetModules } = await import("vitest").then((m) => ({ resetModules: m.vi.resetModules }));
    resetModules();
    const env = await import("@/lib/env");

    // REPRODUCED: no error is thrown; the app silently decides it is a demo.
    expect(env.isSupabaseConfigured).toBe(false);
    expect(env.isDemoMode).toBe(true);
    // EXPECTED AFTER FIX: a production build with a URL but no key should FAIL
    // FAST (throw at startup), never quietly serve the seeded demo tenant.

    process.env = saved;
  });

  it("is correctly configured only when BOTH url and a key are present", async () => {
    const saved = { ...process.env };
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://real.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_abc";
    delete process.env.CONSTRUCTLY_DEMO;

    const { vi } = await import("vitest");
    vi.resetModules();
    const env = await import("@/lib/env");
    expect(env.isSupabaseConfigured).toBe(true);
    expect(env.isDemoMode).toBe(false);

    process.env = saved;
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * CRITICAL — no password-reset / invite recovery flows exist
 * ═══════════════════════════════════════════════════════════════════════ */
describe("account-recovery flows", () => {
  it("HAS a password-reset implementation (request + reset pages)", () => {
    // FIXED (F5): request page calls resetPasswordForEmail; reset page sets the
    // new password. Regression guard — fails if either half is removed.
    expect(grepSrc(/resetPasswordForEmail/).length).toBeGreaterThan(0);
    expect(grepSrc(/auth\.updateUser\(\s*\{\s*password/).length).toBeGreaterThan(0);
    expect(FILES.some((f) => /forgot-password[\\/]page\.tsx$/.test(f))).toBe(true);
    expect(FILES.some((f) => /reset-password[\\/]page\.tsx$/.test(f))).toBe(true);
  });

  it("has NO team-invite flow yet (F6 — still open)", () => {
    const hits = grepSrc(/inviteUserByEmail|generateLink|\/invite|acceptInvite/);
    expect(hits).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * HIGH — error reporting is a stub (no real monitoring)
 * ═══════════════════════════════════════════════════════════════════════ */
describe("HIGH: monitoring/error-reporting is not wired", () => {
  it("ships no error-tracking dependency", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const tracker = Object.keys(deps).find((d) => /sentry|datadog|bugsnag|rollbar|honeybadger/i.test(d));
    expect(tracker).toBeUndefined(); // REPRODUCED: none installed
  });

  it("reportError only logs — no external capture call", () => {
    const logger = readFileSync(path.join(SRC, "lib", "logger.ts"), "utf8");
    // The Sentry call exists only as a commented `Future:` placeholder.
    expect(/^\s*Sentry\.captureException/m.test(logger)).toBe(false);
    expect(logger.includes("// Future: Sentry.captureException")).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * MEDIUM — app-level rate limiting covers exactly one route
 * ═══════════════════════════════════════════════════════════════════════ */
describe("MEDIUM: rate limiting is applied to only the sync route", () => {
  it("has exactly one production caller of rateLimit()", () => {
    // Files that actually invoke the limiter (exclude its own definition).
    const callers = grepSrc(/\brateLimit\(/).filter((f) => !f.endsWith(path.join("lib", "rate-limit.ts")));
    expect(callers.length).toBe(1);
    expect(callers[0].replace(/\\/g, "/")).toMatch(/app\/api\/sync\/route\.ts$/);
    // EXPECTED AFTER FIX: auth-sensitive + financial server actions are also
    // rate-limited (and the limiter is backed by a shared store).
  });
});
