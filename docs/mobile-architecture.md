# Mobile architecture (Capacitor — iOS and Android)

Status: **all eight modules ported to the RPC transport; Android builds a
release APK/AAB.** Not signed, not on Play, not yet exercised on a physical
device — see [android-acceptance.md](./android-acceptance.md), which is the
gate between here and a real tester.

## Why the web app cannot simply be exported

Capacitor bundles static web assets into a native shell. The obvious move —
`output: "export"` in `next.config.ts` — is impossible here, and would stay
impossible without rewriting the backend. Constructly uses, on nearly every
screen, features that Next explicitly lists as unsupported under static export
(`node_modules/next/dist/docs/01-app/02-guides/static-exports.md`):

| Feature in use | Where |
|---|---|
| Server Actions | 17 modules (`src/features/*/server/actions.ts`, `src/lib/auth/actions.ts`) |
| `cookies()` session auth | `@supabase/ssr` via `src/lib/supabase/server.ts` |
| Middleware | `src/middleware.ts` (session refresh) |
| Dynamic routes without `generateStaticParams` | 12 `[id]` routes |
| Route handlers reading `Request` | `/api/sync`, `/auth/callback`, `/auth/confirm` |
| `headers()` | CSP in `next.config.ts` |
| `unstable_cache` | `src/features/branding/server/layout-branding.ts` |

`next build` confirms it: 20 of 30 routes are `ƒ (Dynamic) server-rendered on
demand`.

## What made a real port cheap anyway

The UI layer is already a client-side SPA:

- 102 of 159 `.tsx` files are `"use client"`.
- Pages under `src/app/(app)/` are thin server guards — resolve the user, check a
  permission, render a client view.
- **Every feature's data access goes through a repository interface with a
  runtime transport switch** (`src/features/*/data.ts`), already serving two
  implementations: demo and Server Actions.

So the migration is a *transport swap*, not a rewrite.

## The architecture

```
             ┌───────────────────────── shared src/ ─────────────────────────┐
             │  components · hooks · repositories · schemas · money · RBAC   │
             └───────────────────────────────────────────────────────────────┘
                        │                                    │
        Next build      │                                    │   Vite build
        (Vercel)        │                                    │   (mobile/dist)
                        ▼                                    ▼
                 Server Actions                        HTTP RPC (bearer)
                        │                                    │
                        ▼                                    ▼
              features/*/server/actions.ts  ◄──── src/app/api/mobile/[feature]/[method]
                        │
                        ▼
                  Prisma · Supabase
```

Both platforms end at the **same server functions**. The RPC route is transport
only — it re-implements no query logic and no authorization.

### Transport selection

`src/features/*/data.ts`:

```ts
isDemoMode  ? demoRepository        // in-browser fixtures
: isNativeClient ? httpRepository   // Capacitor → RPC
: serverRepository                  // web → Server Actions (production path)
```

`isNativeClient` (`src/lib/mobile/platform.ts`) is a **build-time constant**
inlined by each bundler, so the unused branches are tree-shaken. The web bundle
never carries the RPC client; the mobile bundle never carries Prisma.

### Authentication

The web app authenticates with cookies. Capacitor serves the bundle from
`capacitor://localhost`, a different origin from the API, so it authenticates
with `Authorization: Bearer <supabase access_token>` instead.

To avoid forking every action into web and mobile variants,
`src/lib/auth/request-context.ts` provides an `AsyncLocalStorage` session store.
The RPC route verifies the token once, resolves the session with the *same*
`resolveSessionUser()` the cookie path uses, then runs the action inside that
store. `getCurrentUser()` checks the store first and otherwise falls through to
the untouched cookie path.

**The store is always empty on the web** — the RPC route is its only caller — so
web auth behaviour is unchanged.

### Security properties

- **Static allowlist.** `src/app/api/mobile/registry.ts` is hand-written. There
  is no `(actions as never)[method]` lookup and no dynamic import, so a request
  cannot reach an unlisted server function even if it is exported from the same
  module. Own-property checks block prototype-chain names.
- **Inherited RBAC.** Every registered function already calls
  `requirePermission()` / `requireProjectWrite()`. Nothing is relaxed for mobile.
- **Server-side token verification.** `verifyBearerToken` round-trips to the auth
  server; JWTs are never decoded locally and trusted.
- **No secrets in the bundle.** `mobile/vite.config.mts` inlines an explicit
  `NEXT_PUBLIC_*` allowlist (never a `process.env` spread), and a Vite plugin
  cuts the import graph at the server boundary by synthesising throwing stubs
  for `server/actions` modules. `scripts/verify-mobile-bundle.mjs` scans the
  built output and fails the build on Prisma or any server secret.

### Next.js shims

`mobile/src/next-shims/` maps `next/link` and `next/navigation` onto react-router
so shared components compile unchanged. The shims are strict: `router.refresh()`
maps to `queryClient.invalidateQueries()` (the faithful equivalent when all data
comes from React Query), while server-only primitives (`redirect`, `notFound`)
throw with an explanatory message rather than silently doing nothing.

## Workflow

```bash
npm run mobile:dev:demo      # SPA on :5300 with fixtures — no backend needed
npm run mobile:build         # → mobile/dist
npm run mobile:verify        # secret scan of the built bundle
npm run mobile:sync          # build + verify + cap sync ios
npm run mobile:sync:android  # build + verify + cap sync android

npm run android:apk          # signed (or unsigned) release APK
npm run android:aab          # release App Bundle for Play
npm run android:verify       # secret scan of the built ARTIFACT
```

A non-demo mobile build requires `NEXT_PUBLIC_MOBILE_API_BASE` — the absolute
origin of the deployed backend. The Vite config refuses to build without it,
because a relative `/api/…` would resolve against the WebView's own origin,
where no server exists, and every screen would fail on the device rather than in
CI.

Capacitor 8 uses **Swift Package Manager**, not CocoaPods, so `cap sync ios`
completes fully on Windows. `cap sync android` likewise needs no macOS.

## Scope

Registered over RPC and mounted in the native router: **all eight modules** —
Dashboard, Projects, Labour (attendance, categories, summary, contractors),
Vendors, Procurement, Payments, Reports and Settings, plus `session.me`.

That is 120 methods across 12 registry features, each forwarding to the same
server function the web app invokes. Adding another is a registry entry plus a
line in the feature's `http-repository.ts` — no new architecture.

The pairing between the two halves is the one link the compiler cannot check:
`rpcMethod("labor", "getSheet")` is two plain strings. `registry.test.ts` scans
every `http-repository.ts` and asserts the registry resolves each pair, so a
typo fails a test instead of returning 404 to a phone.

## Cross-origin, and why it is not optional

The native bundle is served by the platform WebView from its own origin —
`capacitor://localhost` on iOS, `https://localhost` on Android — and calls the
deployed backend. Every RPC carries `Authorization` and
`Content-Type: application/json`, so the WebView preflights.

`src/app/api/mobile/cors.ts` holds a closed origin allowlist and the route
answers `OPTIONS`. Without it Next replies 405, the preflight fails, and every
screen dies on its first fetch — the app looks completely broken while the
server logs show nothing wrong. `/api/sync` carries the same handling, for the
same reason, plus bearer authentication so the offline outbox can flush from a
device that has no cookies.

Credentials are deliberately NOT allowed: this surface is bearer-only, which is
what keeps the cookie/CSRF surface off it.

## Android specifics

| | |
|---|---|
| applicationId | `in.co.constructly.app` — from `capacitor.config.ts`, shared with iOS so the two cannot drift |
| minSdk | 24 (Android 7) |
| compileSdk / targetSdk | 36 (Android 16) |
| AGP / Gradle / JDK | 8.13.0 / 8.14.3 / **21** |
| Permissions | `INTERNET` only |

**JDK 21, not newer.** Gradle 8.14 cannot read Java 24+ class files and fails
during configuration with `Unsupported class file major version`, which names
neither a cause nor a file. Android Studio's bundled runtime is currently 25 —
so the most discoverable JDK on a Windows machine is the one that does not work.
`scripts/android-build.mjs` searches for a supported version and says so plainly
when it only finds an unsupported one.

**The OAuth return leg** is an intent-filter on `MainActivity`, scoped to
`in.co.constructly.app://auth/callback` rather than the bare scheme. The activity
is `launchMode="singleTask"`, so the return arrives at the existing activity via
`onNewIntent` and the PKCE verifier created before the browser opened is still in
memory. A new task would lose it and every Google sign-in would fail.

**Session storage** is the Android Keystore via
`@aparajita/capacitor-secure-storage`, the same plugin the Keychain path uses.
`describeStorage()` reports which store is actually in force, so a silent
downgrade to an unencrypted one cannot pass for the real thing.

## Signing

No production keystore exists yet; release builds are left **unsigned** rather
than falling back to the debug key, because a debug-signed "release" installs
and looks entirely normal but can never be updated by a real release. See
[android-signing.md](./android-signing.md) for creating the upload key and the
distinction between it and the app signing key Google holds.

## What has NOT been proven

Stated plainly, because "it compiles" is not "it works":

- **No physical device run.** Every claim about launch, Google OAuth, session
  persistence across force-stop, deep links, offline flush and the back button
  is a claim about code that has not yet met hardware.
- **Google OAuth end-to-end** depends on two account-level settings that are not
  in this repository: the custom scheme on Supabase's redirect allow-list, and a
  **Web**-type Google client whose redirect URI is Supabase's callback.
  `npm run verify:oauth` checks these without a device.
- **Data written from a device** has not been reconciled against the web app.
  That is step 6 of the acceptance checklist and the thing most worth doing
  first.
- **iOS** is untouched by this phase and remains where the iOS work left it.
