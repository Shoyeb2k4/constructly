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

  it("does not expose server functions under their real export names", () => {
    // `listProjects` IS exported by features/projects/server/actions.ts, but is
    // only reachable through the registered key `list`. A caller cannot address
    // the module's export surface directly.
    expect(lookupRpcMethod("projects", "listProjects")).toBeNull();
    expect(lookupRpcMethod("projects", "duplicateProject")).toBeNull();
    expect(lookupRpcMethod("projects", "removeProject")).toBeNull();
  });

  it("does not expose features that were never registered", () => {
    // Every one of these is a real, exported server action in this codebase.
    expect(lookupRpcMethod("labor", "listCategories")).toBeNull();
    expect(lookupRpcMethod("team", "inviteMember")).toBeNull();
    expect(lookupRpcMethod("procurement", "createPayment")).toBeNull();
    expect(lookupRpcMethod("contracts", "createContract")).toBeNull();
    expect(lookupRpcMethod("rbac", "createRole")).toBeNull();
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
