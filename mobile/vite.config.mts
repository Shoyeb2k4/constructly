import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

/* ── Hard barrier between the mobile bundle and the server ──────────────────
 *
 * The feature `data.ts` files do `import * as server from "./server/actions"`.
 * Even though `isNativeClient` makes that branch dead code, a bundler still has
 * to resolve and parse the whole import graph — which drags in Prisma, the
 * generated client, `node:async_hooks` (via the auth request context) and the
 * server-only env surface. None of that can exist in a browser bundle, let
 * alone ship to a device.
 *
 * Aliasing to a fixed stub file does not work: a namespace import needs the
 * REAL export names to be present, or the bundler errors on every missing
 * binding. So this plugin reads the actual module, extracts its exported names,
 * and synthesises a same-shaped module whose every export throws.
 *
 * Result: the import graph is cut at the server boundary, the bundle stays
 * clean, and any screen ported without switching to the RPC repository fails
 * loudly and legibly instead of shipping a mystery runtime error.
 * `scripts/verify-mobile-bundle.mjs` independently proves the outcome.
 */
/**
 * WHAT COUNTS AS SERVER CODE.
 *
 * Structural, not a list of filenames. This codebase's convention is that
 * everything under a feature's `server/` directory is server-only, so that is
 * what the barrier keys on — ANY module in a `server/` folder, plus the two
 * legacy flat names that predate the convention.
 *
 * It used to enumerate `server/actions` and `server/gather` explicitly, and
 * that is precisely how it broke: new server modules (contracts/amendments,
 * contracts/reconciliation, contractors/advance-rescope, …) were added on the
 * web side, matched nothing here, and were dragged whole into the mobile
 * bundle — where their `import { prisma }` resolved to the empty stub and the
 * build died on a missing export. A rule that has to be extended every time
 * someone adds a file is a rule that will be out of date.
 *
 * Test files are excluded: they never enter the bundle, and stubbing them
 * would only make a failure harder to read if one ever did.
 */
const SERVER_MODULE =
  /[\\/](?:server[\\/][A-Za-z0-9_.-]+|server-actions|upload-actions)(\.ts)?$/;
const SERVER_MODULE_EXCLUDE = /\.(test|spec)\.tsx?$/;

/** `export async function foo(`, `export function foo(`, `export const foo =` */
const EXPORT_PATTERNS = [
  /^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm,
  /^export\s+const\s+([A-Za-z0-9_$]+)/gm,
];

function serverStubPlugin(): Plugin {
  return {
    name: "constructly:server-stub",
    enforce: "pre",
    load(id: string) {
      const file = id.split("?")[0];
      if (!SERVER_MODULE.test(file) || SERVER_MODULE_EXCLUDE.test(file)) return null;

      const names = new Set<string>();
      try {
        const source = readFileSync(file, "utf8");
        for (const pattern of EXPORT_PATTERNS) {
          for (const match of source.matchAll(pattern)) names.add(match[1]);
        }
      } catch {
        // Unreadable module: still stub it rather than let it into the bundle.
      }

      const guard = `
function __serverOnly(name) {
  return function () {
    throw new Error(
      "[mobile] Server Action '" + name + "' was called from the native client. " +
      "Native code must reach the backend through src/lib/mobile/rpc.ts."
    );
  };
}`;
      const stubs = [...names].map(
        (n) => `export const ${n} = __serverOnly(${JSON.stringify(n)});`,
      );
      return [guard, ...stubs, "export default __serverOnly('default');"].join("\n");
    },
  };
}

/**
 * Build of the NATIVE app's web layer.
 *
 * This does not fork the application: it compiles the very same React
 * components out of `src/`, reached through the same `@/*` alias the Next build
 * uses. Only three things are substituted — the Next-specific navigation
 * primitives, the server import graph, and the data transport.
 *
 * Output goes to `mobile/dist`, which is Capacitor's `webDir`. The Next.js
 * build and the Vercel deployment are entirely unaffected by this file.
 */
/**
 * A native build MUST know its backend's absolute origin: a relative `/api/...`
 * would resolve against `capacitor://localhost`, where no server exists, and
 * every screen would fail at runtime on the device. Demo builds are exempt —
 * they never touch the network. Fail at build time rather than on a phone.
 */
const isDemoBuild = process.env.NEXT_PUBLIC_CONSTRUCTLY_DEMO === "1";
if (!isDemoBuild && !process.env.NEXT_PUBLIC_MOBILE_API_BASE) {
  throw new Error(
    "NEXT_PUBLIC_MOBILE_API_BASE is required for a non-demo mobile build " +
      "(the absolute origin of the deployed Constructly backend). " +
      "Set NEXT_PUBLIC_CONSTRUCTLY_DEMO=1 for an offline demo build instead.",
  );
}

export default defineConfig({
  root: __dirname,
  // Assets are loaded from `capacitor://localhost/` inside WKWebView, so every
  // URL must be relative — an absolute `/assets/...` would not resolve.
  base: "./",

  plugins: [serverStubPlugin(), react(), tailwindcss()],

  resolve: {
    alias: [
      // Next.js primitives → strict client-side equivalents.
      { find: /^next\/link$/, replacement: path.resolve(__dirname, "src/next-shims/link.tsx") },
      {
        find: /^next\/navigation$/,
        replacement: path.resolve(__dirname, "src/next-shims/navigation.tsx"),
      },
      // `import "server-only"` is a build-time marker with no runtime behaviour.
      { find: /^server-only$/, replacement: path.resolve(__dirname, "src/empty.ts") },
      // Belt and braces: even if a path slips past serverStubPlugin, the
      // database client itself can never be bundled.
      { find: /^@\/lib\/db\/prisma$/, replacement: path.resolve(__dirname, "src/empty.ts") },
      { find: /^@\/generated\/prisma$/, replacement: path.resolve(__dirname, "src/empty.ts") },
      // Same source tree as the Next build.
      { find: /^@\//, replacement: `${path.resolve(root, "src")}/` },
    ],
  },

  /**
   * Client configuration is inlined at build time, exactly as Next inlines
   * `NEXT_PUBLIC_*`. This is an explicit ALLOWLIST — `process.env` is never
   * spread — so a server secret cannot reach the bundle by accident.
   * `scripts/verify-mobile-bundle.mjs` enforces that independently.
   */
  define: {
    "process.env.NEXT_PUBLIC_MOBILE_CLIENT": JSON.stringify("1"),
    "process.env.NEXT_PUBLIC_MOBILE_API_BASE": JSON.stringify(
      process.env.NEXT_PUBLIC_MOBILE_API_BASE ?? "",
    ),
    "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    ),
    "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    ),
    "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": JSON.stringify(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    ),
    "process.env.NEXT_PUBLIC_CONSTRUCTLY_DEMO": JSON.stringify(
      process.env.NEXT_PUBLIC_CONSTRUCTLY_DEMO ?? "",
    ),
    // Server-only flags are pinned to empty so `src/lib/env.ts` reads them as
    // unset rather than leaving a bare `process.env` reference in the output.
    "process.env.CONSTRUCTLY_DEMO": JSON.stringify(""),
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
  },

  build: {
    outDir: "dist",
    emptyOutDir: true,
    // iOS ships a current WebKit; no need to down-level to ES5.
    target: "es2022",
    sourcemap: false,
  },

  server: {
    port: 5300,
  },
});
