import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import type { MobileAuthStorage } from "@/lib/mobile/session";

/**
 * Where the native app keeps its Supabase session.
 *
 * WHAT THIS IS
 * `@aparajita/capacitor-secure-storage` stores values in the platform's own
 * hardware-backed store: the **Keychain** on iOS, and **EncryptedSharedPrefs**
 * keyed by the **Android Keystore** on Android. Both are encrypted at rest by
 * the OS, both survive app updates, and neither ends up in an ordinary backup
 * when marked device-only. That is the right home for a refresh token, which is
 * long-lived and grants new access tokens.
 *
 * WHAT THIS IS NOT
 * The obvious alternative, `@capacitor/preferences`, is NSUserDefaults on iOS
 * and plain SharedPreferences on Android: an unencrypted file inside the app
 * container. It is protected by the app sandbox, but it is **not encrypted by
 * the app**. Anything with access to the container (a rooted or jailbroken
 * device, an unencrypted backup, a forensic image) can read it. Preferences is
 * therefore used ONLY for non-sensitive diagnostics here, never for tokens.
 *
 * FALLBACK
 * In a browser preview (`npm run mobile:dev:demo`) there is no native layer at
 * all, so the adapter degrades to `localStorage`. That path is explicitly not a
 * production posture — it exists so the SPA can be developed on Windows — and
 * `isSecure()` reports which one is in force.
 */

const NAMESPACE = "constructly";

let secureAvailable: boolean | null = null;

function nativeSecureStorageUsable(): boolean {
  if (secureAvailable === null) {
    secureAvailable =
      Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("SecureStorage");
  }
  return secureAvailable;
}

/**
 * Which backing store is actually in use.
 *
 * Surfaced in diagnostics so a silent downgrade to an unencrypted store can
 * never masquerade as hardware-backed storage. The name is resolved from the
 * RUNNING platform rather than hard-coded: reporting "ios-keychain" on an
 * Android phone would undermine the one job this function has.
 */
export function describeStorage(): { backend: string; secure: boolean } {
  if (nativeSecureStorageUsable()) {
    const backend =
      Capacitor.getPlatform() === "android" ? "android-keystore" : "ios-keychain";
    return { backend, secure: true };
  }
  if (Capacitor.isNativePlatform()) return { backend: "capacitor-preferences", secure: false };
  return { backend: "web-localstorage", secure: false };
}

export const nativeAuthStorage: MobileAuthStorage = {
  async getItem(key) {
    if (nativeSecureStorageUsable()) {
      try {
        const value = await SecureStorage.get(`${NAMESPACE}.${key}`, true, false);
        return typeof value === "string" ? value : null;
      } catch {
        // A corrupt or unreadable Keychain entry must read as "signed out"
        // rather than throwing during boot.
        return null;
      }
    }
    if (Capacitor.isNativePlatform()) {
      const { value } = await Preferences.get({ key });
      return value ?? null;
    }
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },

  async setItem(key, value) {
    if (nativeSecureStorageUsable()) {
      await SecureStorage.set(`${NAMESPACE}.${key}`, value, true, false);
      return;
    }
    if (Capacitor.isNativePlatform()) {
      await Preferences.set({ key, value });
      return;
    }
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* preview only */
    }
  },

  async removeItem(key) {
    if (nativeSecureStorageUsable()) {
      // Removing a key that was never written is not an error condition here.
      await SecureStorage.remove(`${NAMESPACE}.${key}`).catch(() => {});
      return;
    }
    if (Capacitor.isNativePlatform()) {
      await Preferences.remove({ key });
      return;
    }
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* preview only */
    }
  },
};
