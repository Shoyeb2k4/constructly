import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

/**
 * Runtime facts about the Capacitor bridge.
 *
 * Phase 3 proved the app launches and paints, but never proved the native
 * bridge is actually injected into the WKWebView — the app does not use any
 * native API yet, so it would have looked identical either way. Everything in
 * Phase 4 (Keychain storage, the OAuth browser, deep links) depends on the
 * bridge, so it is established explicitly here before anything is built on it.
 */
export interface BridgeStatus {
  /** Capacitor's runtime object is present at all. */
  available: boolean;
  /** "ios" | "android" | "web". */
  platform: string;
  /** False in a browser preview, true inside the app. */
  isNative: boolean;
  /** Per-plugin registration, proving the bridge can actually reach native code
   *  rather than merely existing as a JS shim. */
  plugins: Record<string, boolean>;
}

const WATCHED_PLUGINS = ["Preferences", "Browser", "App", "SecureStorage"] as const;

export function readBridgeStatus(): BridgeStatus {
  const plugins: Record<string, boolean> = {};
  for (const name of WATCHED_PLUGINS) {
    // A registered plugin means the native side answered, not just that a JS
    // package is installed.
    plugins[name] = Capacitor.isPluginAvailable(name);
  }
  return {
    available: typeof Capacitor?.getPlatform === "function",
    platform: Capacitor.getPlatform(),
    isNative: Capacitor.isNativePlatform(),
    plugins,
  };
}

/** Key CI reads back out of the app container. */
export const BRIDGE_DIAGNOSTIC_KEY = "constructly.bridge";

/**
 * Persist the bridge status where CI can verify it WITHOUT relying on logs.
 *
 * Phase 3 established that a simulator carries neither WebView console output
 * nor Capacitor's own native `print()` to CI. Preferences writes to
 * NSUserDefaults, which lands in a plist inside the app's data container, and
 * `xcrun simctl get_app_container` makes that readable from the runner.
 *
 * The write is itself the proof: it can only succeed by crossing the bridge. If
 * the bridge is missing, nothing is written and CI fails.
 *
 * Diagnostics only — never session material. Preferences is NOT encrypted
 * storage; see `secure-storage.ts` for where tokens actually go.
 */
export async function publishBridgeDiagnostics(): Promise<BridgeStatus> {
  const status = readBridgeStatus();
  try {
    await Preferences.set({
      key: BRIDGE_DIAGNOSTIC_KEY,
      value: JSON.stringify({ ...status, at: new Date().toISOString() }),
    });
  } catch {
    // In a browser preview there is no native Preferences; the in-memory status
    // is still returned so the UI can show it.
  }
  return status;
}
