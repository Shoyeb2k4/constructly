import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Apple app identity. Reverse-DNS of the controlled domain `constructly.co.in`.
 *
 * SINGLE SOURCE OF TRUTH — nothing else in this repository hard-codes the
 * bundle identifier. It is not yet registered with Apple, so it can still be
 * changed here (plus `ios/App/App.xcodeproj/project.pbxproj`, which Xcode owns)
 * without hunting through the tree.
 */
export const APP_ID = "in.co.constructly.app";

/**
 * Capacitor wraps the BUNDLED mobile SPA (`mobile/`), not the Next.js server.
 *
 * `webDir` is deliberately NOT `out`: this application cannot be statically
 * exported (Server Actions, cookie-based auth, middleware, dynamic routes — see
 * docs/mobile-architecture.md), so `next build` never produces `out/`. The
 * mobile SPA is a separate Vite build that reuses the same React components and
 * reaches the existing backend over HTTP RPC.
 *
 * `server.url` is intentionally absent — this is a real bundled application,
 * not a WebView pointed at the production website.
 */
const config: CapacitorConfig = {
  appId: APP_ID,
  appName: "Constructly",
  webDir: "mobile/dist",
  ios: {
    // Let the WebView manage safe-area insets; the SPA additionally paints its
    // own `env(safe-area-inset-*)` padding for the notch / home indicator.
    contentInset: "always",
  },
  server: {
    iosScheme: "capacitor",
    androidScheme: "https",
  },
};

export default config;
