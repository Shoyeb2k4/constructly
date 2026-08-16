# Mobile architecture (iOS / Capacitor)

Status: **Phase 1 — scaffolding complete, one vertical slice proven.** Not signed,
not on TestFlight, not compiled on macOS yet.

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
npm run mobile:dev:demo   # SPA on :5300 with fixtures — no backend needed
npm run mobile:build      # → mobile/dist
npm run mobile:verify     # secret scan of the built bundle
npm run mobile:sync       # build + verify + cap sync ios
```

Capacitor 8 uses **Swift Package Manager**, not CocoaPods — there is no
`Podfile`, so `cap sync ios` completes fully on Windows.

## Phase 1 scope

Registered over RPC: `session.me` and the whole `projects` feature. Mounted in
the native router: Dashboard and Projects. Every other route is registered but
renders an explicit placeholder. Adding a feature is a registry entry plus an
`http-repository.ts` — no new architecture.

## Known gaps before TestFlight

**Authentication**

- Google OAuth uses `redirectTo: window.location.origin + "/auth/callback"`,
  which is `capacitor://localhost` natively — Google rejects it. Needs
  `@capacitor/browser` (ASWebAuthenticationSession), a registered custom scheme
  in `CFBundleURLTypes`, an `@capacitor/app` `appUrlOpen` listener, and a
  **client-side** PKCE exchange (the server route cannot hold the verifier).
- Password-reset links must remain `https://` Universal Links (mail clients strip
  custom schemes) → Associated Domains entitlement + an AASA file.
  `/auth/confirm`'s `verifyOtp(token_hash)` flow is already cross-device safe.
- Session storage falls back to WebView localStorage; move to
  `@capacitor/preferences` backed by the Keychain.

**iPhone UI**

- No `env(safe-area-inset-*)` handling in shared components (only the mobile
  shell adds it) — notch / home-indicator clipping.
- Five tables hard-set `min-w-[560px]`–`min-w-[680px]` → forced horizontal scroll
  at 390px.
- `a.download` + `createObjectURL` (`features/procurement/exports.ts`,
  `features/branding/pdf.ts`) is inert in WKWebView → needs
  `@capacitor/filesystem` + `@capacitor/share`.
- `<input type="file">` works but offers no camera capture → `@capacitor/camera`.
- Toaster is bottom-right, colliding with the home indicator; the ⌘K command
  palette has no touch entry point; four `group-hover:opacity-100` reveals are
  invisible on touch.

**Info.plist additions still required:** `CFBundleURLTypes`,
`NSCameraUsageDescription`, `NSPhotoLibraryAddUsageDescription`, and Associated
Domains.
