import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * `.vercelignore` must never be able to remove application source.
 *
 * This is the regression guard for the defect that made the first real-device
 * install fail. `.vercelignore` follows .gitignore matching, in which a pattern
 * containing no slash matches a file or directory of that name at ANY depth.
 * The file said:
 *
 *     ios
 *     mobile        # meant: the Capacitor project and the Vite SPA at the root
 *
 * and `mobile` also matched `src/lib/mobile/` and `src/app/api/mobile/` — the
 * mobile RPC route. Every Vercel deployment silently uploaded a tree with no
 * `/api/mobile/**` in it. The build succeeded, because at that time nothing in
 * the web graph imported those files, so production served a 404 for the one
 * endpoint the Android app needs. On a phone that surfaces as "Failed to fetch",
 * with nothing in any build log to explain it.
 *
 * A leading slash anchors a pattern to the repository root and fixes it. This
 * test makes the mistake unrepeatable.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

/** Non-comment, non-negated patterns, in file order. */
function ignorePatterns(): string[] {
  return readFileSync(path.join(ROOT, ".vercelignore"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"));
}

/** Every tracked path, so the check runs against reality rather than a guess. */
function trackedPaths(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}

/**
 * Does an unrooted, slash-free pattern match a path SEGMENT anywhere in `file`?
 * That is precisely the gitignore rule that caused the outage. Patterns
 * containing a slash, or anchored with one, are scoped and not at issue here.
 */
function matchesAnyDepth(pattern: string, file: string): boolean {
  const name = pattern.replace(/\/$/, "");
  if (name.includes("/") || name.includes("*")) return false;
  return file.split("/").includes(name);
}

describe(".vercelignore cannot remove application source", () => {
  const patterns = ignorePatterns();
  const tracked = trackedPaths();

  it("has patterns to check (guards against a vacuous pass)", () => {
    expect(patterns.length).toBeGreaterThan(3);
    expect(tracked.length).toBeGreaterThan(100);
  });

  it("excludes nothing under src/", () => {
    const casualties: string[] = [];

    for (const pattern of patterns) {
      for (const file of tracked) {
        if (!file.startsWith("src/")) continue;
        if (matchesAnyDepth(pattern, file)) {
          casualties.push(`"${pattern}" excludes ${file}`);
        }
      }
    }

    // Anchor the pattern with a leading slash to scope it to the repo root.
    expect([...new Set(casualties)]).toEqual([]);
  });

  it("still excludes the native projects it is meant to exclude", () => {
    // The fix must not have thrown out the purpose: the Vercel build produces
    // the web app only, and must not carry the Capacitor projects or the SPA.
    for (const dir of ["/ios", "/mobile", "/android"]) {
      expect(patterns, `${dir} should be excluded from the web deploy`).toContain(dir);
    }
  });

  it("keeps the mobile RPC route in the deployment", () => {
    // The specific files whose absence broke the Android app. Named explicitly
    // so this test states what it is protecting.
    const required = [
      "src/app/api/mobile/[feature]/[method]/route.ts",
      "src/app/api/mobile/registry.ts",
      "src/app/api/mobile/cors.ts",
      "src/lib/mobile/platform.ts",
      "src/lib/mobile/rpc.ts",
    ];

    for (const file of required) {
      expect(tracked, `${file} must be tracked`).toContain(file);
      for (const pattern of patterns) {
        expect(
          matchesAnyDepth(pattern, file),
          `"${pattern}" would strip ${file} from the Vercel upload`,
        ).toBe(false);
      }
    }
  });

  it("does not exclude anything the Next build imports from src/", () => {
    // Belt and braces: no tracked .ts/.tsx under src/ may match any pattern.
    const sourceFiles = tracked.filter((f) => f.startsWith("src/") && /\.tsx?$/.test(f));
    expect(sourceFiles.length).toBeGreaterThan(200);

    const excluded = sourceFiles.filter((f) => patterns.some((p) => matchesAnyDepth(p, f)));
    expect(excluded).toEqual([]);
  });
});
