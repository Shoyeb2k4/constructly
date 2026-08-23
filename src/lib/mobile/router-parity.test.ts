import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The native router must mirror the web route tree — including its LAYOUTS.
 *
 * Regression cover for a defect found on a real phone. `mobile/src/router.tsx`
 * mounted every `/labor/*` view but not `src/app/(app)/labor/layout.tsx`, which
 * is where `LaborSectionHeader` renders the Attendance / Contractors / Summary
 * tabs. The routes were registered and reachable by URL, and unreachable by any
 * tap: on the device, the contractor module — the section the app exists to
 * carry into the field — simply could not be opened.
 *
 * Nothing caught it. Every route resolved, every view compiled, 1908 unit tests
 * and 209 E2E tests passed, because the web app gets its layout from the file
 * system and the native app has to be told.
 *
 * So: every nested layout under `(app)` must have its components present in the
 * native router. A new section layout on web now fails here until the router
 * carries it too.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const APP_DIR = path.join(ROOT, "src", "app", "(app)");
const ROUTER = path.join(ROOT, "mobile", "src", "router.tsx");

/** Nested layouts only. The ROOT (app) layout is the shell, which the native
 *  app composes itself in `mobile/src/app.tsx` (AppShell + PermissionProvider). */
function nestedLayouts(dir: string, depth = 0): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...nestedLayouts(full, depth + 1));
    } else if (entry === "layout.tsx" && depth > 0) {
      out.push(full);
    }
  }
  return out;
}

/** Component identifiers imported from `@/...` — the ones a layout renders. */
function importedComponents(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const names: string[] = [];
  for (const m of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"@\/[^"]+"/g)) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/).pop()?.trim();
      // Components, not types or hooks.
      if (name && /^[A-Z]/.test(name)) names.push(name);
    }
  }
  return names;
}

describe("the native router mirrors the web route tree", () => {
  const layouts = nestedLayouts(APP_DIR);
  const router = readFileSync(ROUTER, "utf8");

  it("finds the web layouts to compare against", () => {
    expect(existsSync(ROUTER)).toBe(true);
    // If this ever hits zero the test has stopped checking anything.
    expect(layouts.length).toBeGreaterThan(0);
  });

  it("carries every component that a nested web layout renders", () => {
    const missing: string[] = [];

    for (const layout of layouts) {
      const rel = path.relative(ROOT, layout).split(path.sep).join("/");
      for (const component of importedComponents(layout)) {
        if (!router.includes(component)) {
          missing.push(`${rel} renders <${component}>, which mobile/src/router.tsx does not use`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it("routes every destination in the sidebar", () => {
    // A nav entry the router does not handle falls through to the catch-all and
    // bounces the user to the dashboard with no explanation.
    const nav = readFileSync(path.join(ROOT, "src", "config", "nav.ts"), "utf8");
    const hrefs = [...nav.matchAll(/href:\s*"(\/[a-z-]+)"/g)].map((m) => m[1]);

    expect(hrefs.length).toBeGreaterThan(5);

    const unrouted = hrefs.filter((href) => {
      // `path="/labor"` or a wildcard `path="/labor/*"` both count.
      const escaped = href.replace(/\//g, "\\/");
      return !new RegExp(`path="${escaped}(/\\*|/:|")`).test(router);
    });

    expect(unrouted).toEqual([]);
  });
});
