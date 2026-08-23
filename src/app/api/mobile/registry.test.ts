import { describe, it, expect, vi } from "vitest";

/**
 * The RPC allowlist is the mobile app's entire attack surface: whatever is
 * reachable here runs a real server function against a real tenant. These tests
 * pin the properties that make it safe, so a future edit cannot quietly widen
 * it.
 */

// The registry imports the real server actions, which pull in Prisma. Stub the
// database so this stays a pure unit test.
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

const { lookupRpcMethod } = await import("./registry");

describe("mobile RPC allowlist", () => {
  it("resolves registered methods", () => {
    expect(lookupRpcMethod("projects", "list")).toBeTypeOf("function");
    expect(lookupRpcMethod("projects", "get")).toBeTypeOf("function");
    expect(lookupRpcMethod("session", "me")).toBeTypeOf("function");
  });

  it("registers every feature the native app can reach", () => {
    // The app mounts all eight modules (mobile/src/router.tsx). If a feature
    // silently stops resolving, that module goes blank on the device while the
    // web app carries on working.
    for (const feature of [
      "session",
      "dashboard",
      "projects",
      "contractors",
      "contracts",
      "labor",
      "procurement",
      "team",
      "rbac",
      "branding",
      "payments",
      "budget",
    ]) {
      expect(lookupRpcMethod(feature, "__nope__"), feature).toBeNull();
    }
    // Spot-check one real method per money-bearing feature.
    expect(lookupRpcMethod("contractors", "createSettlement")).toBeTypeOf("function");
    expect(lookupRpcMethod("contracts", "recordContractPayment")).toBeTypeOf("function");
    expect(lookupRpcMethod("procurement", "createPayment")).toBeTypeOf("function");
    expect(lookupRpcMethod("payments", "gather")).toBeTypeOf("function");
  });

  it("does not expose server functions under names it did not register", () => {
    // `projects` registers SHORT keys (`list`, `get`, …), so the module's real
    // export names are not addressable. Elsewhere the registered key matches the
    // repository method name on purpose — one vocabulary across repository,
    // registry and call site. Either way the property that matters is the same:
    // a name that was not written down is not reachable.
    expect(lookupRpcMethod("projects", "listProjects")).toBeNull();
    expect(lookupRpcMethod("projects", "duplicateProject")).toBeNull();
    expect(lookupRpcMethod("projects", "removeProject")).toBeNull();
  });

  it("does not expose server helpers that no repository puts on the wire", () => {
    // Each of these is a real, exported function in a `server/` module. None is
    // part of any Repository interface, so none should be callable — several
    // are the internal guards the registered actions rely on, and reaching one
    // directly would mean calling an action's authorization check instead of
    // the action.
    expect(lookupRpcMethod("contracts", "assertProjectAccess")).toBeNull();
    expect(lookupRpcMethod("contracts", "assertContractorAccess")).toBeNull();
    expect(lookupRpcMethod("contracts", "loadAgreement")).toBeNull();
    expect(lookupRpcMethod("labor", "resolveAttendanceRate")).toBeNull();
    expect(lookupRpcMethod("labor", "eligibleAgreements")).toBeNull();
    expect(lookupRpcMethod("branding", "getLayoutBranding")).toBeNull();
  });

  it("does not expose features that do not exist", () => {
    for (const feature of ["documents", "governance", "settings", "reports", "admin", "sync"]) {
      expect(lookupRpcMethod(feature, "list"), feature).toBeNull();
    }
  });

  it("never resolves inherited object properties", () => {
    for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
      expect(lookupRpcMethod("projects", name)).toBeNull();
      expect(lookupRpcMethod(name, "list")).toBeNull();
    }
  });

  it("rejects unknown features and methods", () => {
    expect(lookupRpcMethod("nope", "list")).toBeNull();
    expect(lookupRpcMethod("projects", "nope")).toBeNull();
    expect(lookupRpcMethod("", "")).toBeNull();
  });
});

describe("mobile RPC does not weaken web authentication", () => {
  it("runWithSession is called from exactly one place", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const SRC = path.resolve(import.meta.dirname, "..", "..", "..");

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) return walk(full);
        return /\.tsx?$/.test(entry) ? [full] : [];
      });

    const callers = walk(SRC)
      .filter((f) => !f.endsWith("request-context.ts") && !f.endsWith("registry.test.ts"))
      .filter((f) => /\brunWithSession\(/.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(/\\/g, "/"));

    // If this ever grows, session injection has spread beyond the mobile
    // boundary — and the guarantee that web requests always resolve their user
    // from cookies no longer holds.
    expect(callers).toHaveLength(1);
    expect(callers[0]).toMatch(/app\/api\/mobile\/\[feature\]\/\[method\]\/route\.ts$/);
  });
});

describe("every repository method the app calls is actually registered", () => {
  /**
   * The one link in this chain TypeScript cannot check.
   *
   * Each `http-repository.ts` is type-checked against its Repository interface,
   * so the CLIENT side is safe. But `rpcMethod("labor", "getSheet")` passes two
   * plain strings, and nothing at compile time proves the registry has a `labor`
   * feature with a `getSheet` key. A typo there compiles perfectly and then
   * returns 404 to a phone.
   *
   * So: read every http-repository, extract the pairs it actually asks for, and
   * assert the registry answers each one.
   */
  it("resolves every (feature, method) pair used by an http-repository", async () => {
    const { readFileSync, readdirSync, existsSync } = await import("node:fs");
    const path = await import("node:path");
    const FEATURES = path.resolve(import.meta.dirname, "..", "..", "..", "features");

    const pairs: Array<{ file: string; feature: string; method: string }> = [];
    for (const dir of readdirSync(FEATURES)) {
      const file = path.join(FEATURES, dir, "http-repository.ts");
      if (!existsSync(file)) continue;
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/rpcMethod\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g)) {
        pairs.push({ file: `${dir}/http-repository.ts`, feature: m[1], method: m[2] });
      }
    }

    // Guards against the test quietly passing because the scan found nothing.
    expect(pairs.length).toBeGreaterThan(100);

    const unresolved = pairs
      .filter(({ feature, method }) => lookupRpcMethod(feature, method) === null)
      .map(({ file, feature, method }) => `${file}: ${feature}.${method}`);

    expect(unresolved).toEqual([]);
  });
});
