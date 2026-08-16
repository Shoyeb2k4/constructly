/**
 * Which transport the client bundle should use.
 *
 * This is a BUILD-TIME literal, not a runtime capability probe. The Vite mobile
 * build defines `NEXT_PUBLIC_MOBILE_CLIENT="1"`; the Next build never sets it.
 * That matters twice over:
 *
 *  - `isNativeClient` folds to a constant in each bundle, so the transport the
 *    build does not use is tree-shaken away — the web bundle never carries the
 *    RPC client, and the mobile bundle never carries the Server Action imports
 *    (which would drag Prisma in with them).
 *  - Nothing in `src/` has to import `@capacitor/core`, so the Next.js build and
 *    the Vercel deployment stay completely unaware that Capacitor exists.
 */
export const isNativeClient = process.env.NEXT_PUBLIC_MOBILE_CLIENT === "1";

/**
 * Absolute origin of the Next.js backend the mobile app talks to. Required in
 * the mobile bundle: a relative `/api/...` would resolve against
 * `capacitor://localhost`, where no server exists. Empty on the web, where
 * relative URLs are correct.
 */
export const mobileApiBase = process.env.NEXT_PUBLIC_MOBILE_API_BASE ?? "";
